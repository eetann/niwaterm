import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      // `niwaterm docs list`がトピックの説明として表示するため、省略を許さない（ADR 0008）
      extend: z.object({ description: z.string().min(1) }),
    }),
  }),
};
