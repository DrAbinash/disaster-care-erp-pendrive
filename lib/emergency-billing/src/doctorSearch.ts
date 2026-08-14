/**
 * Referring-doctor search for the emergency bill form.
 * Tokens are AND-matched as case-insensitive substrings of
 * `name` + `specialization`, so prefix, middle-of-word, and
 * middle-word hits all succeed (e.g. "eer" → "Dr Meera Rao").
 */

export interface DoctorSearchRecord {
  name: string;
  specialization?: string | null;
}

export function doctorSearchTokens(query: string): string[] {
  return String(query ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function doctorMatchesQuery(doctor: DoctorSearchRecord, query: string): boolean {
  const tokens = doctorSearchTokens(query);
  if (tokens.length === 0) return true;
  const hay = `${doctor.name} ${doctor.specialization ?? ""}`.toLowerCase();
  return tokens.every((token) => hay.includes(token));
}

export function searchCachedDoctors<T extends DoctorSearchRecord>(
  doctors: readonly T[],
  query: string,
  limit = 40,
): T[] {
  return doctors.filter((doctor) => doctorMatchesQuery(doctor, query)).slice(0, limit);
}
