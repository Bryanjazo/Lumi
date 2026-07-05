// Lumi · "Hey Lumi" wake-phrase matcher — PURE, no native imports.
//
// Split out of lib/heyLumi.ts so scripts/test-heylumi-wake.ts can
// exercise it under tsx without dragging in react-native. The wake
// engine imports it back; behavior is identical.

// "hey/okay + name" or the bare name. The recognizer routinely
// mangles "Lumi" (loomy / lumee / luna…) — accept the common
// mishears. BARE tokens (no hey/okay) are the close-to-"lumi" set
// only: bare "luna"/"loona" is the cat's actual name and shows up in
// normal speech ("feed luna"), and bare "lume"/"luma"/"lumia" are
// ordinary-word mishears (TV/ambient audio) — all of those need the
// hey/okay prefix to count.
const WAKE_TOKEN =
  /(?:(hey|okay|ok|hay|hi)[\s,]+)?(lumi|loomi|loomie|loomy|lumee|lumy|lume|lummi|luma|lumia|luna|loona)(?![a-z])/gi;

const BARE_EXCLUDED = /^(luna|loona|lume|luma|lumia)$/i;

/**
 * Find a wake occurrence; everything after it is the command.
 *
 * `which` matters because session transcripts are cumulative:
 * - 'last' (wake mode): earlier chatter may contain rejected tokens,
 *   and the freshest "hey lumi" is the one that counts — slice off
 *   everything before it ("…so anyway, hey lumi, remind me…").
 * - 'first' (command mode): the command has STARTED; the first
 *   accepted occurrence is the wake we already fired on. Using
 *   'last' here would wipe the command when the user says the name
 *   mid-sentence ("remind me to ask Lumi about the invoice").
 */
export const matchWake = (
  text: string,
  which: 'first' | 'last' = 'last',
): { tail: string } | null => {
  WAKE_TOKEN.lastIndex = 0;
  let hit: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = WAKE_TOKEN.exec(text))) {
    const prev = m.index > 0 ? text[m.index - 1] : ' ';
    if (/[a-z]/i.test(prev)) continue; // inside a word ("alumina")
    if (!m[1] && BARE_EXCLUDED.test(m[2])) continue;
    hit = m;
    if (which === 'first') break;
  }
  if (!hit) return null;
  return {
    tail: text
      .slice(hit.index + hit[0].length)
      .replace(/^[\s,.!?:—–-]+/, ''),
  };
};


