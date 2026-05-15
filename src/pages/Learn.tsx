import { Card, CardHeader } from '../components/ui/Card';
import { Pill } from '../components/ui/Pill';

const CARDS: { title: string; body: string; figure: 'waterfall' | 'narrow' | 'drift' | 'rfi' | 'repeat' }[] = [
  {
    title: 'What is a waterfall plot?',
    body:
      'It is a 2D image where the horizontal axis is frequency, the vertical axis is time, and brightness is the radio energy at that channel and moment. A persistent bright vertical line is a signal that stayed on; a slanted line is a signal whose frequency drifted.',
    figure: 'waterfall'
  },
  {
    title: 'What is a narrowband signal?',
    body:
      'Most natural cosmic radio sources spread their energy over wide bands. A signal that lives in a single very thin channel — like a laser pointer in radio — is unusual. Almost all known narrowband emitters are made by humans.',
    figure: 'narrow'
  },
  {
    title: 'What is Doppler drift?',
    body:
      'A distant transmitter and the Earth are moving relative to each other. That motion makes the observed frequency drift slightly, producing a small slant on the waterfall. SETI searches look specifically for narrowband signals that drift in this expected way.',
    figure: 'drift'
  },
  {
    title: 'Why is Earth radio interference a problem?',
    body:
      'Phones, satellites, GPS, microwaves, even bad cabling produce strong narrowband radio energy. They can overwhelm distant signals and they can fool simple detectors. SignalScope flags signals that look too wide, too steady, or are also seen across many channels at once.',
    figure: 'rfi'
  },
  {
    title: 'Why repeat observations matter',
    body:
      'A single bright candidate is never enough. A real claim requires the same kind of signal to reappear when the telescope re-points to the same target — and to disappear when it points away. Without that "on/off" test, the most likely answer is local interference.',
    figure: 'repeat'
  }
];

export function Learn() {
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col items-start gap-3">
          <Pill tone="cyan">Learning mode</Pill>
          <h2 className="text-2xl font-semibold text-slate-50">
            How SignalScope listens to the sky
          </h2>
          <p className="max-w-3xl text-sm text-slate-400">
            A short, jargon-light introduction to the ideas behind a modern SETI search.
            None of this needs a physics degree — just curiosity.
          </p>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {CARDS.map((c) => (
          <Card key={c.title}>
            <CardHeader title={c.title} />
            <div className="grid grid-cols-3 gap-4 items-center">
              <div className="col-span-1">
                <Figure kind={c.figure} />
              </div>
              <p className="col-span-2 text-sm leading-relaxed text-slate-300">{c.body}</p>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="A short, honest disclaimer" />
        <p className="text-sm leading-relaxed text-slate-300">
          SignalScope is an educational citizen-science prototype. It does not contact any
          real telescope or coordinate with any real SETI working group. It analyzes public
          archive data or user-supplied filterbank files locally in the browser, and any
          interesting-looking signal here is still most likely instrumental or terrestrial
          interference. Real SETI claims go through years of peer review.
        </p>
      </Card>
    </div>
  );
}

function Figure({ kind }: { kind: 'waterfall' | 'narrow' | 'drift' | 'rfi' | 'repeat' }) {
  const w = 220;
  const h = 120;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full rounded-lg border border-white/5 bg-space-950">
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5ee0ff" />
          <stop offset="100%" stopColor="#0b1020" />
        </linearGradient>
      </defs>
      <rect width={w} height={h} fill="#05070f" />
      {kind === 'waterfall' && (
        <>
          {Array.from({ length: 24 }).map((_, i) => (
            <rect
              key={i}
              x={Math.random() * w}
              y={Math.random() * h}
              width={2}
              height={2}
              fill={`rgba(94,224,255,${0.2 + Math.random() * 0.5})`}
            />
          ))}
          <rect x={w / 2 - 1.5} y={4} width={3} height={h - 8} fill="#fbbf24" opacity={0.8} />
        </>
      )}
      {kind === 'narrow' && (
        <>
          <rect x={0} y={0} width={w} height={h} fill="url(#g1)" opacity={0.25} />
          <rect x={w * 0.55} y={6} width={2} height={h - 12} fill="#5ee0ff" />
        </>
      )}
      {kind === 'drift' && (
        <>
          <rect x={0} y={0} width={w} height={h} fill="url(#g1)" opacity={0.25} />
          <line x1={40} y1={10} x2={170} y2={h - 10} stroke="#5ee0ff" strokeWidth={2} />
        </>
      )}
      {kind === 'rfi' && (
        <>
          <rect x={0} y={0} width={w} height={h} fill="url(#g1)" opacity={0.25} />
          <rect x={70} y={6} width={48} height={h - 12} fill="#f472b6" opacity={0.7} />
          <rect x={20} y={30} width={w - 40} height={6} fill="#f472b6" opacity={0.5} />
        </>
      )}
      {kind === 'repeat' && (
        <>
          <rect x={0} y={0} width={w / 2 - 2} height={h} fill="#0b1020" />
          <rect x={w / 2 + 2} y={0} width={w / 2 - 2} height={h} fill="#0b1020" />
          <rect x={w / 4 - 1} y={10} width={2} height={h - 20} fill="#5ee0ff" />
          <text x={w / 4} y={h - 4} fontSize={9} textAnchor="middle" fill="#94a3b8">ON</text>
          <text x={(3 * w) / 4} y={h - 4} fontSize={9} textAnchor="middle" fill="#94a3b8">OFF</text>
        </>
      )}
    </svg>
  );
}
