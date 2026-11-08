import { StrictMode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusStamp } from './data';
import { DataTable, type Column, type SortState } from './table';
import { KitProvider } from './words';

type Item = {
  id: string;
  name: string;
  category: string;
  stock: number;
  rate: number;
  status: 'due' | 'paid';
};
const items: Item[] = [
  { id: 'p1', name: 'UltraTech PPC', category: 'Cement', stock: 120, rate: 39000, status: 'due' },
  { id: 'p2', name: 'ACC Gold', category: 'Cement', stock: 80, rate: 41050, status: 'paid' },
  { id: 'p3', name: 'TMT 12mm', category: 'Sariya', stock: 40, rate: 6200, status: 'paid' },
];
const columns: Column<Item>[] = [
  { id: 'name', header: 'Maal', value: (row) => row.name, sortable: true },
  { id: 'category', header: 'Kism', value: (row) => row.category, phone: 'secondary' },
  {
    id: 'stock',
    header: 'Stock',
    kind: 'qty',
    value: (row) => row.stock,
    total: true,
    sortable: true,
  },
  { id: 'rate', header: 'Rate', kind: 'money', exact: true, value: (row) => row.rate, total: true },
  {
    id: 'status',
    header: 'Haal',
    kind: 'status',
    cell: (row) => <StatusStamp kind={row.status} />,
    phone: 'hidden',
  },
];
const base = {
  label: 'Stock',
  rows: items,
  columns,
  rowId: (row: Item) => row.id,
  rowName: (row: Item) => row.name,
  empty: { title: 'Abhi koi maal nahi' },
  layout: 'table' as const,
};

describe('DataTable on a laptop', () => {
  it('draws a ruled ledger: typed cells, numbers right, a double rule before money, a total', () => {
    render(<DataTable {...base} />);
    const table = screen.getByRole('table', { name: 'Stock' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((th) => th.textContent),
    ).toEqual(['Maal', 'Kism', 'Stock', 'Rate', 'Haal']);
    const row = within(table).getAllByRole('row')[1]!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[2]!.textContent).toBe('120');
    expect(cells[2]!.className).toMatch(/num/);
    expect(cells[3]!.textContent).toBe('₹390.00');
    expect(cells[3]!.className).toMatch(/ruleBefore/);
    expect(cells[0]!.className).toMatch(/stickyFirst/);
    expect(within(row).getByText('Baaki')).toBeTruthy();
    const total = table.querySelector('tfoot tr')!;
    expect(total.textContent).toBe('Kul240₹862.50');
  });

  it('server totals win over adding up the rows on the page', () => {
    render(<DataTable {...base} totals={{ stock: 9999, rate: 100 }} />);
    expect(screen.getByRole('table').querySelector('tfoot')!.textContent).toBe('Kul9,999₹1.00');
  });

  it('asks the server to sort, and says how it is sorted', async () => {
    function Sorted() {
      const [sort, setSort] = useState<SortState>(null);
      return (
        <>
          <DataTable {...base} sort={sort} onSortChange={setSort} />
          <output data-testid="sort">{JSON.stringify(sort)}</output>
        </>
      );
    }
    render(<Sorted />);
    const byName = screen.getByRole('button', { name: 'Maal se lagao' });
    await userEvent.click(byName);
    expect(screen.getByTestId('sort').textContent).toBe('{"id":"name","desc":false}');
    expect(byName.closest('th')!.getAttribute('aria-sort')).toBe('ascending');
    await userEvent.click(byName);
    expect(byName.closest('th')!.getAttribute('aria-sort')).toBe('descending');
    // Numbers sort high to low first: the biggest stock is what people look for.
    await userEvent.click(screen.getByRole('button', { name: 'Stock se lagao' }));
    expect(screen.getByTestId('sort').textContent).toBe('{"id":"stock","desc":true}');
    // The rows are shown as the server sent them; the table does not reorder them itself.
    expect(screen.getAllByRole('row')[1]!.textContent).toContain('UltraTech PPC');
  });

  it('groups rows with a subtotal per group, and a group can fold away', async () => {
    render(<DataTable {...base} groupBy="category" />);
    const table = screen.getByRole('table');
    const cement = screen.getByRole('button', { name: 'Cement chhupao' });
    expect(cement.textContent).toContain('2 line');
    const subtotals = [...table.querySelectorAll('tbody tr')].filter((tr) =>
      /subtotalRow/.test(tr.className),
    );
    expect(subtotals.map((tr) => tr.textContent)).toEqual([
      'Cement · Kul200₹800.50',
      'Sariya · Kul40₹62.00',
    ]);
    await userEvent.click(cement);
    expect(screen.queryByText('ACC Gold')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Cement dikhao' }).getAttribute('aria-expanded'),
    ).toBe('false');
    // Folded, the group still shows what it adds up to.
    expect(table.textContent).toContain('Cement · Kul200₹800.50');
  });

  it('choosing a row in a grouped table leaves the groups open (StrictMode, as Next runs in dev)', async () => {
    function Grouped() {
      const [chosen, setChosen] = useState<Set<string>>(new Set());
      return (
        <DataTable {...base} groupBy="category" selected={chosen} onSelectedChange={setChosen} />
      );
    }
    render(
      <StrictMode>
        <Grouped />
      </StrictMode>,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'ACC Gold chuno' }));
    expect(screen.getByRole('checkbox', { name: 'ACC Gold chuno' })).toHaveProperty(
      'checked',
      true,
    );
    expect(
      screen.getByRole('button', { name: 'Cement chhupao' }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByText('TMT 12mm')).toBeTruthy();
  });

  it('selects rows, all rows, and offers the bulk actions on what was chosen', async () => {
    const bulk = vi.fn((ids: string[]) => <button type="button">Rate badlo {ids.length}</button>);
    function Picking() {
      const [chosen, setChosen] = useState<Set<string>>(new Set());
      return (
        <DataTable {...base} selected={chosen} onSelectedChange={setChosen} bulkActions={bulk} />
      );
    }
    render(<Picking />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'ACC Gold chuno' }));
    expect(screen.getByText('1 chune')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rate badlo 1' })).toBeTruthy();
    const all = screen.getByRole('checkbox', { name: 'Sab line chuno' }) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    await userEvent.click(all);
    expect(screen.getByText('3 chune')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Chunna hatao' }));
    expect(screen.queryByText(/chune$/)).toBeNull();
  });

  it('keyboard: arrows move, Enter opens, x selects, Home and End jump', async () => {
    const open = vi.fn();
    function Keys() {
      const [chosen, setChosen] = useState<Set<string>>(new Set());
      return <DataTable {...base} onOpen={open} selected={chosen} onSelectedChange={setChosen} />;
    }
    render(<Keys />);
    const rows = () => screen.getAllByRole('row').slice(1, 4);
    expect(rows().map((row) => row.tabIndex)).toEqual([0, -1, -1]);
    rows()[0]!.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(rows()[1]);
    await userEvent.keyboard('{Enter}');
    expect(open).toHaveBeenLastCalledWith(items[1]);
    await userEvent.keyboard('x');
    expect(rows()[1]!.getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(rows()[2]);
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(rows()[0]);
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(rows()[0]);
  });

  it('a click opens the row, but not a click on its checkbox or its menu', async () => {
    const open = vi.fn();
    const remove = vi.fn();
    render(
      <DataTable
        {...base}
        columns={[...columns, { id: 'do', header: 'Kaam', kind: 'actions' }]}
        onOpen={open}
        selected={new Set()}
        onSelectedChange={() => {}}
        rowMenu={(row) => [
          { label: 'Rate badlo', onSelect: () => {} },
          { label: `Hatao ${row.name}`, onSelect: remove, danger: true },
        ]}
      />,
    );
    await userEvent.click(screen.getByText('TMT 12mm'));
    expect(open).toHaveBeenCalledWith(items[2]);
    open.mockClear();
    await userEvent.click(screen.getByRole('checkbox', { name: 'TMT 12mm chuno' }));
    const menu = screen.getByRole('button', { name: 'TMT 12mm ke aur kaam' });
    await userEvent.click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.textContent).toBe('Rate badlo');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('Hatao TMT 12mm');
    await userEvent.keyboard('{Enter}');
    expect(remove).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    await userEvent.click(menu);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(menu);
  });

  it('shows loading, an error with a retry, and an empty state that says what will appear', async () => {
    const retry = vi.fn();
    const { rerender } = render(<DataTable {...base} state="loading" />);
    expect(screen.getByRole('status', { name: 'Ho raha hai' })).toBeTruthy();
    rerender(<DataTable {...base} state="error" onRetry={retry} />);
    expect(screen.getByRole('alert').textContent).toContain('List nahi aayi.');
    await userEvent.click(screen.getByRole('button', { name: 'Dobara try karo' }));
    expect(retry).toHaveBeenCalledOnce();
    rerender(
      <DataTable
        {...base}
        rows={[]}
        empty={{ title: 'Abhi koi maal nahi', action: <button type="button">Maal jodo</button> }}
      />,
    );
    expect(screen.getByText('Abhi koi maal nahi')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Maal jodo' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('offers the server CSV of the current filter', () => {
    render(<DataTable {...base} exportHref="/api/v1/stock.csv?q=cem" />);
    const link = screen.getByRole('link', { name: 'CSV download karo' });
    expect(link.getAttribute('href')).toBe('/api/v1/stock.csv?q=cem');
    expect(link.hasAttribute('download')).toBe(true);
  });

  it('never acts on a chosen row that is no longer on screen', async () => {
    const bulk = vi.fn((ids: string[]) => <span data-testid="ids">{ids.join(',')}</span>);
    const chosen = new Set(['p1', 'p3']);
    const { rerender } = render(
      <DataTable {...base} selected={chosen} onSelectedChange={() => {}} bulkActions={bulk} />,
    );
    expect(screen.getByTestId('ids').textContent).toBe('p1,p3');
    // A filter took TMT 12mm away; it stays chosen in the page's state but is not acted on.
    rerender(
      <DataTable
        {...base}
        rows={items.slice(0, 2)}
        selected={chosen}
        onSelectedChange={() => {}}
        bulkActions={bulk}
      />,
    );
    expect(screen.getByText('1 chune')).toBeTruthy();
    expect(screen.getByTestId('ids').textContent).toBe('p1');
    rerender(
      <DataTable
        {...base}
        rows={items.slice(1, 2)}
        selected={chosen}
        onSelectedChange={() => {}}
        bulkActions={bulk}
      />,
    );
    expect(screen.queryByTestId('ids')).toBeNull();
  });

  it('a CSV link that is not http(s) is not shown', () => {
    render(<DataTable {...base} exportHref="javascript:alert(1)" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows text as text: a name with markup never becomes markup', () => {
    const sneaky = [{ ...items[0]!, id: 'x', name: '<img src=x onerror=alert(1)>' }];
    const { container } = render(<DataTable {...base} rows={sneaky} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  });

  it('speaks the page language', () => {
    render(
      <KitProvider language="hi">
        <DataTable {...base} />
      </KitProvider>,
    );
    expect(screen.getByRole('table').querySelector('tfoot')!.textContent).toMatch(/^कुल/);
    expect(screen.getByText('बाकी')).toBeTruthy();
  });
});

describe('DataTable on a phone', () => {
  it('draws two-line rows: the name left, the figure right, the rest below', () => {
    render(<DataTable {...base} layout="list" />);
    const list = screen.getByRole('list', { name: 'Stock' });
    const first = within(list).getAllByRole('listitem')[0]!;
    expect(first.textContent).toBe('UltraTech PPCCement · 120₹390.00');
    // A hidden column stays off the phone.
    expect(within(list).queryByText('Baaki')).toBeNull();
    expect(screen.getByText('Kul').parentElement!.textContent).toBe('Kul₹862.50');
  });

  it('keeps grouping, selection and the keyboard', async () => {
    const open = vi.fn();
    function Phone() {
      const [chosen, setChosen] = useState<Set<string>>(new Set());
      return (
        <DataTable
          {...base}
          layout="list"
          groupBy="category"
          onOpen={open}
          selected={chosen}
          onSelectedChange={setChosen}
        />
      );
    }
    render(<Phone />);
    expect(screen.getByText('Cement · Kul').parentElement!.textContent).toBe('Cement · Kul₹800.50');
    const rows = screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-row'));
    rows[0]!.focus();
    await userEvent.keyboard('{ArrowDown}x{Enter}');
    expect(rows[1]!.getAttribute('aria-selected')).toBe('true');
    expect(open).toHaveBeenCalledWith(items[1]);
  });
});

describe('DataTable with many rows', () => {
  const many = Array.from({ length: 10000 }, (_, index) => ({
    id: `r${index}`,
    name: `Item ${index}`,
    category: index < 5000 ? 'Cement' : 'Sariya',
    stock: index,
    rate: 100,
    status: 'paid' as const,
  }));

  it('draws only what fits on screen, quickly, and still adds up every row', () => {
    // jsdom has no layout: give every box a laptop-sized height so the virtualiser has a window.
    const height = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(640);
    const width = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1024);
    const started = performance.now();
    const { container } = render(<DataTable {...base} rows={many} />);
    const took = performance.now() - started;
    const drawn = container.querySelectorAll('tbody tr[data-row]').length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(120);
    expect(container.querySelector('tfoot')!.textContent).toBe('Kul4,99,95,000₹10,000.00');
    expect(container.querySelector('table')!.getAttribute('aria-rowcount')).toBe('10001');
    // jsdom is slow; a real browser is measured in tests/desk-kit.spec.ts, with End to the last row.
    expect(took).toBeLessThan(3000);
    height.mockRestore();
    width.mockRestore();
  });
});
