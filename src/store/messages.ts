/** Messages live here and nowhere else: a plain array in RAM.
 *  There is no database, no cache, no file. Locking the vault drops it. */
export type Msg = {
  id: string;
  kind: 'in' | 'out' | 'system';
  body: string;
  at: number;
};

let seq = 0;
export const mkMsg = (kind: Msg['kind'], body: string, at = Date.now()): Msg => ({
  id: `${at}-${seq++}`,
  kind,
  body,
  at,
});
