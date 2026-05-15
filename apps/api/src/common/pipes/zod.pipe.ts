/**
 * Generische Zod-Validation-Pipe für NestJS.
 *
 * Verwendung:
 *   @Patch("me")
 *   updateMe(@Body(new ZodValidationPipe(UpdateProfileDtoSchema)) dto: UpdateProfileDto) { … }
 *
 * Bei Validation-Fehler wirft die Pipe BadRequestException mit der issues-Liste.
 */
import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: result.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
          message: i.message,
        })),
      });
    }
    return result.data;
  }
}
