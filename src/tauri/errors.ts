/** Text of an error from invoke() (Rust returns plain strings) or a thrown Error. */
export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}
