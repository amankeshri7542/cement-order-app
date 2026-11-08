import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, IconButton, Kbd } from './actions';
import {
  Checkbox,
  Combobox,
  DateInput,
  MoneyInput,
  NumberInput,
  Segmented,
  Select,
  Switch,
  TextInput,
  type ComboOption,
} from './inputs';
import { FilterBar, FilterChip, SearchBox } from './filters';
import { KitProvider } from './words';

describe('Button', () => {
  it('names its look and size, and keeps the old ghost name working', () => {
    render(
      <>
        <Button variant="quiet" size="sm">
          Quiet
        </Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Hatao</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Quiet' }).className).toMatch(/quiet/);
    expect(screen.getByRole('button', { name: 'Quiet' }).className).toMatch(/small/);
    expect(screen.getByRole('button', { name: 'Ghost' }).className).toMatch(/ghost/);
    expect(screen.getByRole('button', { name: 'Hatao' }).className).toMatch(/danger/);
  });

  it('while loading, says it is working and refuses a second press', async () => {
    const press = vi.fn();
    render(
      <Button loading onClick={press}>
        Save karo
      </Button>,
    );
    const button = screen.getByRole('button', { name: /Save karo/ });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toContain('Ho raha hai');
    await userEvent.click(button);
    expect(press).not.toHaveBeenCalled();
  });

  it('an icon button always has a name', () => {
    render(<IconButton label="Aur kaam" icon="⋮" />);
    expect(screen.getByRole('button', { name: 'Aur kaam' })).toBeTruthy();
    render(<Kbd>/</Kbd>);
    expect(document.querySelector('kbd')?.textContent).toBe('/');
  });
});

describe('text and number fields', () => {
  it('ties the label, the hint and the error to the control', () => {
    render(<TextInput label="Naam" value="" onChange={() => {}} hint="Jaise likha hai" />);
    const input = screen.getByRole('textbox', { name: 'Naam' });
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Jaise likha hai',
    );
    render(<TextInput label="Phone" value="12" onChange={() => {}} error="10 ank chahiye" />);
    const phone = screen.getByRole('textbox', { name: 'Phone' });
    expect(phone.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('10 ank chahiye');
  });

  it('a number is null until it is a number inside the limits', async () => {
    const seen: (number | null)[] = [];
    render(
      <NumberInput
        label="Bori"
        value={null}
        min={1}
        max={500}
        onChange={(v) => seen.push(v)}
        unit="bori"
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Bori' });
    await userEvent.type(input, '50');
    expect(seen.at(-1)).toBe(50);
    await userEvent.clear(input);
    await userEvent.type(input, '600');
    expect(seen.at(-1)).toBeNull();
    await userEvent.clear(input);
    await userEvent.type(input, '2.5');
    expect(seen.at(-1)).toBeNull();
    expect((input as HTMLInputElement).value).toBe('2.5');
  });

  it('MoneyInput gives paise, refuses a bad amount and tidies on leaving', async () => {
    function Holder() {
      const [paise, setPaise] = useState<number | null>(null);
      return (
        <>
          <MoneyInput label="Rakam" value={paise} onChange={setPaise} />
          <output data-testid="paise">{String(paise)}</output>
        </>
      );
    }
    render(<Holder />);
    const input = screen.getByRole('textbox', { name: 'Rakam' }) as HTMLInputElement;
    await userEvent.type(input, '1,250.5');
    expect(screen.getByTestId('paise').textContent).toBe('125050');
    fireEvent.blur(input);
    expect(input.value).toBe('1250.50');
    await userEvent.clear(input);
    await userEvent.type(input, '12.345');
    expect(screen.getByTestId('paise').textContent).toBe('null');
    await userEvent.clear(input);
    await userEvent.type(input, '-5');
    expect(screen.getByTestId('paise').textContent).toBe('null');
  });

  it('MoneyInput follows a value the page changes', () => {
    const { rerender } = render(<MoneyInput label="Rakam" value={50000} onChange={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'Rakam' }) as HTMLInputElement;
    expect(input.value).toBe('500');
    rerender(<MoneyInput label="Rakam" value={1234} onChange={() => {}} />);
    expect(input.value).toBe('12.34');
  });
});

describe('choices', () => {
  it('Select, Switch and Checkbox say their state', async () => {
    const pick = vi.fn();
    render(
      <Select
        label="Dukaan"
        value="a"
        onChange={pick}
        options={[
          { value: 'a', label: 'Main' },
          { value: 'b', label: 'Doosri' },
        ]}
      />,
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Dukaan' }), 'b');
    expect(pick).toHaveBeenCalledWith('b');

    const flip = vi.fn();
    render(<Switch label="Alert chalu" checked={false} onChange={flip} />);
    const toggle = screen.getByRole('switch', { name: 'Alert chalu' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await userEvent.click(toggle);
    expect(flip).toHaveBeenCalledWith(true);

    render(<Checkbox label="Sab" checked={false} indeterminate onChange={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Sab' }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
  });

  it('Segmented is one radio group with counts', async () => {
    const pick = vi.fn();
    render(
      <Segmented
        label="Dukaan"
        value="all"
        onChange={pick}
        options={[
          { value: 'all', label: 'Sab', count: 1240 },
          { value: 'main', label: 'Main' },
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Dukaan' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Sab 1,240/ })).toHaveProperty('checked', true);
    await userEvent.click(screen.getByRole('radio', { name: 'Main' }));
    expect(pick).toHaveBeenCalledWith('main');
  });
});

describe('DateInput', () => {
  it('a day sheet looks back: Aaj and Kal (yesterday), and no future day', async () => {
    const pick = vi.fn();
    render(<DateInput label="Din" value="2026-11-08" today="2026-11-08" onChange={pick} />);
    expect(screen.getByRole('button', { name: 'Aaj' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Kal' }));
    expect(pick).toHaveBeenLastCalledWith('2026-11-07');
    const picker = screen.getByLabelText('Din chuno') as HTMLInputElement;
    expect(picker.max).toBe('2026-11-08');
    fireEvent.change(picker, { target: { value: '2026-11-09' } });
    expect(pick).toHaveBeenCalledTimes(1);
    fireEvent.change(picker, { target: { value: '2026-10-01' } });
    expect(pick).toHaveBeenLastCalledWith('2026-10-01');
  });

  it('a delivery looks ahead: Kal is tomorrow, and the past is out of reach', async () => {
    const pick = vi.fn();
    render(
      <KitProvider language="en">
        <DateInput label="Day" value="" direction="future" today="2026-12-31" onChange={pick} />
      </KitProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Tomorrow' }));
    expect(pick).toHaveBeenLastCalledWith('2027-01-01');
    expect((screen.getByLabelText('Pick a date') as HTMLInputElement).min).toBe('2026-12-31');
  });
});

describe('Combobox', () => {
  const people: ComboOption[] = [
    { id: 'c1', label: 'Ramesh Kumar', hint: '98765 43210' },
    { id: 'c2', label: 'Kumar Hardware' },
    { id: 'c3', label: 'Suresh' },
  ];

  it('filters a list on the page, moves with arrows and picks with Enter', async () => {
    const pick = vi.fn();
    render(<Combobox label="Grahak" value={null} onSelect={pick} options={people} />);
    const input = screen.getByRole('combobox', { name: 'Grahak' });
    await userEvent.type(input, 'kum');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Kumar Hardware',
      'Ramesh Kumar98765 43210',
    ]);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toMatch(/-1$/);
    await userEvent.keyboard('{Enter}');
    expect(pick).toHaveBeenLastCalledWith(people[0]);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('says when nothing matches, and Escape closes it', async () => {
    render(<Combobox label="Grahak" value={null} onSelect={() => {}} options={people} />);
    const input = screen.getByRole('combobox', { name: 'Grahak' });
    await userEvent.type(input, 'zzz');
    expect(screen.getByText('Kuch nahi mila')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('asks the server, and a slow old answer never replaces a newer one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const answers: Record<string, () => void> = {};
    const search = vi.fn(
      (query: string) =>
        new Promise<ComboOption[]>((resolve) => {
          answers[query] = () => resolve([{ id: query, label: `Result ${query}` }]);
        }),
    );
    render(<Combobox label="Maal" value={null} onSelect={() => {}} search={search} delay={10} />);
    const input = screen.getByRole('combobox', { name: 'Maal' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ce' } });
    await act(async () => vi.advanceTimersByTime(20));
    fireEvent.change(input, { target: { value: 'cem' } });
    await act(async () => vi.advanceTimersByTime(20));
    await act(async () => answers.cem?.());
    await act(async () => answers.ce?.());
    await waitFor(() =>
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Result cem']),
    );
    vi.useRealTimers();
  });

  it('typing again clears a choice made earlier', async () => {
    const pick = vi.fn();
    render(<Combobox label="Grahak" value={people[2]!} onSelect={pick} options={people} />);
    await userEvent.type(screen.getByRole('combobox', { name: 'Grahak' }), 'x');
    expect(pick).toHaveBeenCalledWith(null);
  });
});

describe('filters', () => {
  it('"/" puts the cursor in the search, unless someone is typing elsewhere', async () => {
    render(
      <>
        <input aria-label="Note" />
        <SearchBox label="Dhoondho" value="" onChange={() => {}} />
      </>,
    );
    const search = screen.getByRole('searchbox', { name: 'Dhoondho' });
    await userEvent.keyboard('/');
    expect(document.activeElement).toBe(search);
    const note = screen.getByRole('textbox', { name: 'Note' });
    note.focus();
    await userEvent.keyboard('/');
    expect(document.activeElement).toBe(note);
    expect((note as HTMLInputElement).value).toBe('/');
  });

  it('Escape and the clear button empty the search', async () => {
    const change = vi.fn();
    render(<SearchBox label="Dhoondho" value="cem" onChange={change} />);
    await userEvent.click(screen.getByRole('button', { name: 'Khoj hatao' }));
    expect(change).toHaveBeenLastCalledWith('');
    change.mockClear();
    screen.getByRole('searchbox').focus();
    await userEvent.keyboard('{Escape}');
    expect(change).toHaveBeenLastCalledWith('');
  });

  it('a chip is pressed or not, with its live count', async () => {
    const change = vi.fn();
    render(
      <FilterBar
        label="Filter"
        chips={<FilterChip label="Kam" count={12} pressed={false} onChange={change} />}
      />,
    );
    expect(screen.getByRole('group', { name: 'Filter' })).toBeTruthy();
    const chip = screen.getByRole('button', { name: 'Kam 12' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(chip);
    expect(change).toHaveBeenCalledWith(true);
  });
});
