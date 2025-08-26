import { Buffer } from 'buffer';
import * as Jimp from 'jimp';
import http from 'http';
import https from 'https';
import { version } from '../package.json';
import {
  Base64EncodedImage,
  CaptionOutput,
  QueryOutput,
  DetectOutput,
  PointOutput,
  CaptionRequest,
  QueryRequest,
  DetectRequest,
  PointRequest,
} from './types';

export interface MoondreamVLConfig {
  apiKey?: string;
  endpoint?: string;
}
const DEFAULT_ENDPOINT = 'https://api.moondream.ai/v1';

export class vl {
  private apiKey: string;
  private endpoint: string;

  constructor(config: MoondreamVLConfig) {
    this.apiKey = config.apiKey || '';
    this.endpoint = config.endpoint || DEFAULT_ENDPOINT;
    if (this.apiKey === '' && this.endpoint === DEFAULT_ENDPOINT) {
      throw new Error(
        'An apiKey is required for cloud inference. '
      );
    }
  }

  private async encodeImage(
    image: Buffer | Base64EncodedImage
  ): Promise<Base64EncodedImage> {
    if ('imageUrl' in image) {
      return image;
    }

    try {
  // Process image with Jimp
  const jimpImage = await (Jimp as any).read(image as Buffer);

      const width = jimpImage.bitmap?.width;
      const height = jimpImage.bitmap?.height;

      if (!width || !height) {
        throw new Error('Unable to get image dimensions');
      }

  jimpImage.quality(95);
  const buffer = await jimpImage.getBufferAsync('image/jpeg');

      const base64Image = buffer.toString('base64');
      return {
        imageUrl: `data:image/jpeg;base64,${base64Image}`,
      };
    } catch (error) {
      throw new Error(
        `Failed to convert image to JPEG: ${(error as Error).message}`
      );
    }
  }

  private makeRequest(path: string, body: any, stream: boolean = false): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.endpoint + path);
      const requestBody = JSON.stringify(body);

      const options = {
        method: 'POST',
        headers: {
          'X-Moondream-Auth': this.apiKey,
          'Content-Type': 'application/json',
          'User-Agent': `moondream-node/${version}`,
          'Content-Length': Buffer.byteLength(requestBody)
        }
      };

      const client = url.protocol === 'https:' ? https : http;
      const req = client.request(url, options, (res) => {
        if (stream) {
          resolve(res);
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP error! status: ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Failed to parse JSON response: ${(error as Error).message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(requestBody);
      req.end();
    });
  }

  private async* streamResponse(response: any): AsyncGenerator<string, void, unknown> {
    let buffer = '';

    try {
      for await (const chunk of response) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if ('chunk' in data) {
                yield data.chunk;
              }
              if (data.completed) {
                return;
              }
            } catch (error) {
              throw new Error(`Failed to parse JSON response from server: ${(error as Error).message}`);
            }
          }
        }
      }

      // Handle any remaining data in the buffer
      if (buffer) {
        const lines = buffer.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if ('chunk' in data) {
                yield data.chunk;
              }
            } catch (error) {
              throw new Error(`Failed to parse JSON response from server: ${(error as Error).message}`);
            }
          }
        }
      }
    } catch (error) {
      throw new Error(`Failed to stream response: ${(error as Error).message}`);
    }
  }

  public async caption(
    request: CaptionRequest
  ): Promise<CaptionOutput> {
    const encodedImage = await this.encodeImage(request.image);

    const requestBody: any = {
      image_url: encodedImage.imageUrl,
      length: request.length,
      stream: request.stream,
    };

    if (request.variant) {
      requestBody.variant = request.variant;
    }

    const response = await this.makeRequest('/caption', requestBody, request.stream);

    if (request.stream) {
      return { caption: this.streamResponse(response) };
    }

    return { caption: response.caption };
  }

  public async query(
    request: QueryRequest
  ): Promise<QueryOutput> {
    let requestBody: any = {
      question: request.question,
      stream: request.stream,
    };

    if (request.image) {
      const encodedImage = await this.encodeImage(request.image);
      requestBody.image_url = encodedImage.imageUrl;
    }

    if (request.reasoning !== undefined) {
      requestBody.reasoning = request.reasoning;
    }

    if (request.variant) {
      requestBody.variant = request.variant;
    }

    const response = await this.makeRequest('/query', requestBody, request.stream);

    if (request.stream) {
      return { answer: this.streamResponse(response) };
    }

    const result: QueryOutput = { answer: response.answer };
    if (response.reasoning) {
      result.reasoning = response.reasoning;
    }
    return result;
  }

  public async detect(
    request: DetectRequest
  ): Promise<DetectOutput> {
    const encodedImage = await this.encodeImage(request.image);

    const requestBody: any = {
      image_url: encodedImage.imageUrl,
      object: request.object,
    };

    if (request.variant) {
      requestBody.variant = request.variant;
    }

    const response = await this.makeRequest('/detect', requestBody);

    return { objects: response.objects };
  }

  public async point(
    request: PointRequest
  ): Promise<PointOutput> {
    const encodedImage = await this.encodeImage(request.image);

    const requestBody: any = {
      image_url: encodedImage.imageUrl,
      object: request.object,
    };

    if (request.variant) {
      requestBody.variant = request.variant;
    }

    const response = await this.makeRequest('/point', requestBody);

    return { points: response.points };
  }
}