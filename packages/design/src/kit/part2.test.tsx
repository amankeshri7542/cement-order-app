import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarChart, ChartFrame, LineChart, StackedBarChart } from './charts';
import { Banner, EmptyState, Skeleton, Toast } from './feedback';
import { Card, PageHeader, Section, SplitView, Toolbar } from './layout';
import { Dialog, Drawer, Menu, Popover, Tooltip, useOpenParam } from './overlays';
import { axisLabel, niceTicks, place } from './place';
import { KitProvider } from './words';

describe('placing a popover', () => {
  const screenBox = { width: 400, height: 800 };
  it('goes below its anchor, lined up with its start', () => {
    expect(
      place({ top: 100, left: 20, width: 80, height: 40 }, { width: 200, height: 100 }, screenBox),
    ).toEqual({
      top: 144,
      left: 20,
      side: 'below',
    });
  });
  it('flips above when there is no room below, and stays 8 px inside the screen', () => {
    const spot = place(
      { top: 740, left: 350, width: 40, height: 40 },
      { width: 200, height: 150 },
      screenBox,
    );
    expect(spot).toEqual({ top: 586, left: 192, side: 'above' });
  });
  it('a panel taller than the screen is kept on it', () => {
    const spot = place(
      { top: 300, left: 0, width: 40, height: 40 },
      { width: 600, height: 2000 },
      screenBox,
    );
    expect(spot.top).toBe(8);
    expect(spot.left).toBe(8);
  });
  it('lines up with the end when asked', () => {
    expect(
      place({ top: 0, left: 300, width: 40, height: 40 }, { width: 100, height: 50 }, screenBox, {
        align: 'end',
      }).left,
    ).toBe(240);
  });
});

describe('axis steps and labels', () => {
  it('picks clean steps that reach the largest value', () => {
    expect(niceTicks(8750)).toEqual([0, 2500, 5000, 7500, 10000]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(Number.NaN)).toEqual([0]);
    expect(niceTicks(-5)).toEqual([0]);
  });
  it('writes small numbers in full and big ones the Indian short way', () => {
    expect(axisLabel(9999)).toBe('9,999');
    expect(axisLabel(120000, true)).toBe('₹1.2L');
    expect(axisLabel(12000000)).toBe('1.2Cr');
  });
});

describe('Popover and Menu', () => {
  it('a popover opens next to its anchor, and Escape or a press outside closes it', async () => {
    const close = vi.fn();
    function Holder() {
      const anchor = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={anchor}>Anchor</button>
          <button>Elsewhere</button>
          <Popover open onClose={close} anchor={anchor} role="dialog" label="Picker">
            <p>Inside</p>
          </Popover>
        </>
      );
    }
    render(<Holder />);
    expect(screen.getByRole('dialog', { name: 'Picker' }).textContent).toBe('Inside');
    await userEvent.click(screen.getByText('Inside'));
    expect(close).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(close).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('a menu button opens a menu, moves with arrows, skips disabled items and gives focus back', async () => {
    const edit = vi.fn();
    const remove = vi.fn();
    render(
      <Menu
        label="Aur"
        items={[
          { label: 'Badlo', onSelect: edit },
          { label: 'Band hai', onSelect: () => {}, disabled: true },
          { label: 'Hatao', onSelect: remove, danger: true },
        ]}
      />,
    );
    const button = screen.getByRole('button', { name: /Aur/ });
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    await userEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.textContent).toBe('Badlo');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('Hatao');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('Badlo');
    await userEvent.keyboard('{End}{Enter}');
    expect(remove).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button);
    expect(screen.queryByRole('menu')).toBeNull();
    // ArrowDown on the button opens it too; Escape closes and returns.
    button.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(edit).not.toHaveBeenCalled();
  });

  it('an empty menu draws no button', () => {
    const { container } = render(<Menu label="Aur" items={[]} />);
    expect(container.textContent).toBe('');
  });
});

describe('Tooltip', () => {
  afterEach(() => vi.useRealTimers());
  it('shows on hover and focus, stays while hovered, and Escape hides it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <Tooltip text="Pichhle 30 din">
        <button>Range</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Range' });
    // The words are tied to the control for screen readers even while hidden.
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Pichhle 30 din',
    );
    fireEvent.pointerEnter(button);
    expect(screen.getAllByText('Pichhle 30 din')).toHaveLength(2);
    fireEvent.pointerLeave(button);
    const shown = screen.getAllByText('Pichhle 30 din')[1]!;
    fireEvent.pointerEnter(shown);
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.getAllByText('Pichhle 30 din')).toHaveLength(2);
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => {});
    expect(screen.getAllByText('Pichhle 30 din')).toHaveLength(1);
    act(() => button.focus());
    expect(screen.getAllByText('Pichhle 30 din')).toHaveLength(2);
    act(() => button.blur());
    expect(screen.getAllByText('Pichhle 30 din')).toHaveLength(1);
  });
});

describe('Drawer', () => {
  it('opens with focus on its title, closes on Escape and gives focus back', async () => {
    function Holder() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Kholo</button>
          <Drawer
            open={open}
            title="Order SC-12"
            onClose={() => setOpen(false)}
            footer={<button>Save</button>}
          >
            <p>Detail</p>
          </Drawer>
        </>
      );
    }
    render(<Holder />);
    const opener = screen.getByRole('button', { name: 'Kholo' });
    await userEvent.click(opener);
    const drawer = screen.getByRole('dialog', { name: 'Order SC-12' });
    expect(drawer.getAttribute('aria-modal')).toBe('false');
    expect(document.activeElement).toBe(
      within(drawer).getByRole('heading', { name: 'Order SC-12' }),
    );
    expect(within(drawer).getByRole('button', { name: /Wapas/ })).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Band karo' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('a menu inside the drawer takes Escape first', async () => {
    const close = vi.fn();
    render(
      <Drawer open title="D" onClose={close}>
        <Menu label="Aur" items={[{ label: 'A', onSelect: () => {} }]} />
      </Drawer>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Aur/ }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });
});

describe('the open row in the address', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));
  it('reads, writes and follows back, and ignores anything that is not an id', async () => {
    window.history.replaceState(null, '', '/orders?status=open&open=ord_12');
    function Holder() {
      const [open, setOpen] = useOpenParam();
      return (
        <>
          <output>{open ?? 'none'}</output>
          <button onClick={() => setOpen('ord-99')}>Next</button>
          <button onClick={() => setOpen(null)}>Shut</button>
        </>
      );
    }
    render(<Holder />);
    expect(screen.getByRole('status').textContent).toBe('ord_12');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(window.location.search).toBe('?status=open&open=ord-99');
    await userEvent.click(screen.getByRole('button', { name: 'Shut' }));
    expect(window.location.search).toBe('?status=open');
    act(() => {
      window.history.replaceState(null, '', '/orders?open=%3Cscript%3E');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByRole('status').textContent).toBe('none');
  });
});

describe('Dialog', () => {
  it('shows its title and actions only while open, and Escape asks to close', () => {
    const close = vi.fn();
    const { rerender } = render(
      <Dialog open={false} title="Pakka?" onClose={close}>
        Body
      </Dialog>,
    );
    expect(screen.queryByText('Body')).toBeNull();
    rerender(
      <Dialog open title="Pakka?" onClose={close} actions={<button>Haan</button>}>
        Body
      </Dialog>,
    );
    expect(screen.getByText('Body')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Haan' })).toBeTruthy();
    fireEvent(document.querySelector('dialog')!, new Event('cancel', { cancelable: true }));
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('feedback', () => {
  afterEach(() => vi.useRealTimers());
  it('a toast with undo leaves by itself, but not while the pointer is on it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const close = vi.fn();
    const undo = vi.fn();
    render(
      <Toast onClose={close} duration={1000} action={{ label: 'Wapas lo', onPress: undo }}>
        Rate badla
      </Toast>,
    );
    const toast = screen.getByRole('status');
    fireEvent.pointerEnter(toast);
    await act(async () => vi.advanceTimersByTime(3000));
    expect(close).not.toHaveBeenCalled();
    fireEvent.pointerLeave(toast);
    await act(async () => vi.advanceTimersByTime(1100));
    expect(close).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Wapas lo' }));
    expect(undo).toHaveBeenCalledOnce();
  });

  it('an error toast and an error banner are announced at once; others wait their turn', () => {
    render(
      <>
        <Toast error>Save nahi hua</Toast>
        <Banner tone="error" title="Galla save nahi hua">
          Pichhli entry save hai.
        </Banner>
        <Banner tone="info" title="Note" />
      </>,
    );
    expect(screen.getAllByRole('alert').map((node) => node.textContent)).toEqual([
      'Save nahi hua',
      '!Galla save nahi huaPichhli entry save hai.',
    ]);
    expect(screen.getByRole('status').textContent).toBe('iNote');
  });

  it('an empty state says what will appear and offers one action; skeletons say they are loading', () => {
    render(
      <>
        <EmptyState
          title="Abhi koi bill nahi"
          body="Turant bill yahan dikhenge."
          action={<button>Bill banao</button>}
        />
        <Skeleton label="Aa raha hai" kind="rows" count={4} />
        <Skeleton label="Tiles" kind="tiles" />
        <Skeleton label="Page" />
      </>,
    );
    expect(screen.getByText('Turant bill yahan dikhenge.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bill banao' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Aa raha hai' }).children).toHaveLength(4);
    expect(screen.getByRole('status', { name: 'Tiles' }).children).toHaveLength(3);
  });
});

describe('layout', () => {
  it('the page header holds the title, the context and the actions', () => {
    render(
      <PageHeader
        title="Stock"
        context="Sab dukaan · 8 Nov"
        actions={<button>CSV</button>}
        main={<button>Maal jodo</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Stock' })).toBeTruthy();
    expect(screen.getByText('Sab dukaan · 8 Nov')).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['CSV', 'Maal jodo']);
  });

  it('a section and a card are named by their headings', () => {
    render(
      <Section title="Aaj">
        <Card title="Galla">₹0</Card>
      </Section>,
    );
    expect(screen.getByRole('region', { name: 'Aaj' })).toBeTruthy();
    expect(screen.getByRole('article', { name: 'Galla' })).toBeTruthy();
  });

  it('a toolbar is one tab stop, and the arrows move inside it', async () => {
    render(
      <>
        <Toolbar label="Kaam">
          <button>Ek</button>
          <button disabled>Band</button>
          <button>Do</button>
        </Toolbar>
        <button>Bahar</button>
      </>,
    );
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe('Ek');
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement?.textContent).toBe('Do');
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement?.textContent).toBe('Ek');
    await userEvent.keyboard('{End}');
    expect(document.activeElement?.textContent).toBe('Do');
    await userEvent.tab();
    expect(document.activeElement?.textContent).toBe('Bahar');
  });

  it('a split view shows a back button only with an item open', async () => {
    const back = vi.fn();
    const { rerender } = render(
      <SplitView
        label="Order"
        list={<p>List</p>}
        detail={<p>Detail</p>}
        open={false}
        onBack={back}
      />,
    );
    expect(screen.queryByRole('button', { name: /Wapas/ })).toBeNull();
    rerender(
      <SplitView label="Order" list={<p>List</p>} detail={<p>Detail</p>} open onBack={back} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Wapas/ }));
    expect(back).toHaveBeenCalledOnce();
  });
});

describe('charts', () => {
  const days = [
    { label: '1 Nov', value: 120000 },
    { label: '2 Nov', value: 0 },
    { label: '3 Nov', value: 450000 },
    { label: '4 Nov', value: 300000 },
  ];

  it('a chart is one tap from a table with the same numbers', async () => {
    render(
      <ChartFrame
        title="Bikri"
        table={{ head: ['Din', 'Bikri'], rows: days.map((d) => [d.label, String(d.value)]) }}
      >
        <BarChart label="Bikri" data={days} money />
      </ChartFrame>,
    );
    const toggle = screen.getByRole('button', { name: 'Table dekho' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(toggle);
    const table = screen.getByRole('table', { name: 'Bikri' });
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((th) => th.textContent),
    ).toEqual(['1 Nov', '2 Nov', '3 Nov', '4 Nov']);
    await userEvent.click(screen.getByRole('button', { name: 'Chart dekho' }));
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('bars: one per value, nothing for zero, thin, rounded at the top only, and the tallest labelled', () => {
    const { container } = render(<BarChart label="Bikri" data={days} money />);
    const bars = [...container.querySelectorAll('path')].map(
      (path) => path.getAttribute('d') ?? '',
    );
    expect(bars.filter(Boolean)).toHaveLength(3);
    for (const d of bars.filter(Boolean)) expect(d).toMatch(/^M[\d.]+,[\d.]+V[\d.]+Q/);
    const labels = [...container.querySelectorAll('text')].map((text) => text.textContent);
    expect(labels).toContain('₹4,500');
    expect(labels).not.toContain('₹1,200');
    // The axis is in rupees: ₹4,500 at most gives steps up to ₹6,000.
    expect(labels).toEqual(expect.arrayContaining(['₹0', '₹2,000', '₹4,000', '₹6,000']));
  });

  it('the keyboard walks the chart and the tooltip says each value', async () => {
    render(<BarChart label="Bikri" data={days} money />);
    const chart = screen.getByRole('group', { name: /Bikri/ });
    act(() => chart.focus());
    expect(screen.getByRole('status').textContent).toBe('4 Nov₹3,000');
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('status').textContent).toBe('1 Nov₹1,200');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('status').textContent).toBe('2 Nov₹0');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stacked bars have a legend, keep at most five parts in order, and leave a gap between parts', () => {
    const { container } = render(
      <KitProvider language="en">
        <StackedBarChart
          label="Money in"
          names={['Cash', 'UPI', 'Udhaar', 'A', 'B', 'Six']}
          data={[{ label: 'Mon', parts: [100, 50, 25, 0, 0, 999] }]}
        />
      </KitProvider>,
    );
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Cash',
      'UPI',
      'Udhaar',
      'A',
      'B',
    ]);
    const paths = [...container.querySelectorAll('path')].filter((path) => path.getAttribute('d'));
    expect(paths).toHaveLength(3);
    expect(paths.map((path) => path.getAttribute('class'))).toEqual([
      expect.stringContaining('s1'),
      expect.stringContaining('s2'),
      expect.stringContaining('s3'),
    ]);
  });

  it('a line has a crosshair on the active point, and one series needs no legend', async () => {
    const { container } = render(
      <LineChart
        label="Udhaar"
        names={['Udhaar']}
        data={days.map((d) => ({ label: d.label, values: [d.value] }))}
        money
      />,
    );
    expect(container.querySelector('ul')).toBeNull();
    expect(container.querySelectorAll('polyline')).toHaveLength(1);
    expect([...container.querySelectorAll('text')].map((t) => t.textContent)).toContain('₹3,000');
    act(() => screen.getByRole('group').focus());
    expect(container.querySelector('line[class*="crosshair"]')).toBeTruthy();
  });

  it('says so when there is nothing to draw', () => {
    render(<BarChart label="Bikri" data={[]} />);
    expect(screen.getByText('Abhi dikhane ko kuch nahi')).toBeTruthy();
  });

  it('names from data stay text', () => {
    const { container } = render(
      <BarChart label="x" data={[{ label: '<b>bold</b>', value: 5 }]} />,
    );
    expect(container.querySelector('b')).toBeNull();
  });
});
