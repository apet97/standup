import { validateStandupName } from '../validation';

export function requireName(args: string): string | null {
  const name = args.trim();
  if (!name) return null;
  const result = validateStandupName(name);
  if (!result.valid) return null;
  return name;
}
