"use client";

const BASE = 60;
const WHITE = [0, 2, 4, 5, 7, 9, 11, 12];
const BLACK: { left: string; semi: number }[] = [
  { left: "9%", semi: 1 },
  { left: "22%", semi: 3 },
  { left: "48%", semi: 6 },
  { left: "61%", semi: 8 },
  { left: "74%", semi: 10 },
];

const KEY_TO_SEMI: Record<string, number> = {
  a: 0,
  d: 4,
  e: 3,
  f: 5,
  g: 7,
  h: 9,
  j: 11,
  k: 12,
  s: 2,
  t: 6,
  u: 10,
  w: 1,
  y: 8,
};

interface PianoProps {
  held: number[];
  onDown: (note: number) => void;
  onUp: (note: number) => void;
}

export function noteFromKey(key: string): number | null {
  const semi = KEY_TO_SEMI[key.toLowerCase()];
  if (semi === undefined) {
    return null;
  }
  return BASE + semi;
}

export function Piano({ held, onDown, onUp }: PianoProps) {
  return (
    <div>
      <div className="relative h-28 w-full">
        <div className="flex h-full gap-1">
          {WHITE.map((semi) => {
            const note = BASE + semi;
            const on = held.includes(note);
            return (
              <button
                className={`h-full flex-1 rounded-md border border-black/50 ${on ? "bg-amber-300" : "bg-orange-500"}`}
                key={note}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  onDown(note);
                }}
                onPointerLeave={() => onUp(note)}
                onPointerUp={() => onUp(note)}
                type="button"
              />
            );
          })}
        </div>
        {BLACK.map((key) => {
          const note = BASE + key.semi;
          const on = held.includes(note);
          return (
            <button
              className={`absolute top-0 h-[58%] w-[8%] rounded-b-md border border-black ${on ? "bg-orange-200" : "bg-neutral-950"}`}
              key={note}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                onDown(note);
              }}
              onPointerLeave={() => onUp(note)}
              onPointerUp={() => onUp(note)}
              style={{ left: key.left }}
              type="button"
            />
          );
        })}
      </div>
      <p className="mt-2 text-white/45 text-xs">
        Keys, or the letters a w s e d f t g y h u j k.
      </p>
    </div>
  );
}
