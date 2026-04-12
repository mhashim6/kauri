/**
 * Type declaration for `.sql` text imports.
 *
 * Bun supports importing arbitrary files as text via the import attribute
 * `with { type: 'text' }`. The migration codegen at
 * `scripts/embed-migrations.ts` uses this to embed SQL into the binary.
 * TypeScript needs an ambient declaration to recognise the module shape.
 */
declare module '*.sql' {
  const content: string;
  export default content;
}
