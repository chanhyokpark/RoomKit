import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z, ZodType } from 'zod';

export class ZodValidationPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: z.treeifyError(result.error),
      });
    }
    return result.data;
  }
}
