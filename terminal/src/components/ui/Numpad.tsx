interface Props {
  onDigit: (digit: string) => void;
  onClear: () => void;
  onBackspace: () => void;
  disabled?: boolean;
}

// 3x4 grid: 1-9, then [Clear, 0, ⌫]. Big buttons sized for adult fingers on a
// touch screen. Using regular <button> so OS-level keyboard navigation still
// works for the rare case the cashier has a hardware keypad attached.
const ROW_1 = ['1', '2', '3'];
const ROW_2 = ['4', '5', '6'];
const ROW_3 = ['7', '8', '9'];

export function Numpad({ onDigit, onClear, onBackspace, disabled }: Props) {
  const digit = (d: string) => (
    <button
      key={d}
      type="button"
      className="key"
      onClick={() => onDigit(d)}
      disabled={disabled}
    >
      {d}
    </button>
  );

  return (
    <div className="numpad">
      {ROW_1.map(digit)}
      {ROW_2.map(digit)}
      {ROW_3.map(digit)}
      <button
        type="button"
        className="key utility"
        onClick={onClear}
        disabled={disabled}
      >
        Clear
      </button>
      {digit('0')}
      <button
        type="button"
        className="key utility"
        onClick={onBackspace}
        disabled={disabled}
        aria-label="Backspace"
      >
        ⌫
      </button>
    </div>
  );
}
