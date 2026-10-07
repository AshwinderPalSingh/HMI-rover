import { Keyboard } from 'lucide-react';
import { app } from '../../state/store';
import { Dialog, Kbd } from '../ui';

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: 'Safety',
    rows: [[['Space'], 'STOP — cancel navigation and zero velocity (works unless you are typing in a non-empty field)']],
  },
  {
    title: 'Modes & views',
    rows: [
      [['1'], 'Drive'],
      [['2'], 'Map'],
      [['3'], 'Label'],
      [['4'], 'Command'],
      [['C'], 'Swap camera and map'],
      [['?'], 'This help'],
    ],
  },
  {
    title: 'Driving (Drive and Map modes)',
    rows: [
      [['W', '↑'], 'Forward'],
      [['S', '↓'], 'Reverse'],
      [['A', '←'], 'Turn left'],
      [['D', '→'], 'Turn right'],
    ],
  },
  {
    title: 'Map tools',
    rows: [
      [['V'], 'Select & pan'],
      [['G'], 'Send navigation goal (drag for heading)'],
      [['P'], 'Set AMCL pose estimate'],
      [['L'], 'Place a label'],
      [['K'], 'Draw keep-out zone (Enter to finish, Backspace undo)'],
      [['F'], 'Follow robot'],
      [['0'], 'Fit map'],
      [['+', '−'], 'Zoom'],
      [['Esc'], 'Cancel tool / close'],
    ],
  },
  {
    title: 'Command',
    rows: [
      [['/'], 'Focus the command box'],
      [['M'], 'Speak a command'],
    ],
  },
];

export function ShortcutsDialog() {
  return (
    <Dialog title="Keyboard shortcuts" icon={Keyboard} onClose={() => app().patch({ dialog: null })} width={640}>
      <div className="shortcuts">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.rows.map(([keys, what]) => (
                <div key={what} className="shortcuts__row">
                  <dt>
                    {keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && <span className="muted"> / </span>}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
