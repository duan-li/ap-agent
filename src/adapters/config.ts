import { z } from 'zod';

const config = z.object({
  MODEL_PROVIDER: z.enum(['fake', 'anthropic']).default('fake'),
  ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
  DATA_DIR: z.string().trim().min(1).default('data'),
}).refine(value => value.MODEL_PROVIDER !== 'anthropic' || value.ANTHROPIC_API_KEY !== undefined,
  { path: ['ANTHROPIC_API_KEY'], message: 'Required for the Anthropic provider' });

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = config.safeParse(env);
  if (!result.success) {
    const names = result.error.issues.map(issue => issue.path.join('.'));
    throw new Error('Invalid environment settings: ' + names.join(', '));
  }
  return result.data;
}
