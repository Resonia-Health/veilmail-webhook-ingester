/**
 * Dynamically import a module by name without TypeScript resolving the module types.
 * This allows optional peer dependencies to be loaded at runtime without
 * requiring their type declarations at compile time.
 */
export async function importModule(name: string): Promise<unknown> {
  // Using Function constructor to prevent TypeScript from analyzing the import
  // and trying to resolve the module's type declarations.
  const dynamicImport = new Function('name', 'return import(name)') as (
    name: string,
  ) => Promise<unknown>
  return dynamicImport(name)
}
