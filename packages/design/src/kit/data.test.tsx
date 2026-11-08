import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DateText,
  KpiTile,
  LedgerTotal,
  MoneyText,
  Pager,
  QtyText,
  StatusStamp,
  stamps,
} from './data';
import { KitProvider } from './words';

describe('MoneyText and friends', () => {
  it('keeps paise by default, whole rupees when asked, and a dash instead of ₹0', () => {
    const { container } = render(
      <>
        <MoneyText value={125050} />
        <MoneyText value={125050} exact={false} />
        <MoneyText value={0} zero="dash" />
      </>,
    );
    const spans = container.querySelectorAll('span');
    expect(spans[0]!.textContent).toBe('₹1,250.50');
    expect(spans[1]!.textContent).toBe('₹1,251');
    expect(spans[2]!.textContent).toBe('—');
    expect(spans[2]!.getAttribute('aria-label')).toBe('Kuch nahi');
  });

  it('a signed amount drops its sign and says due or advance by colour', () => {
    const { container } = render(
      <>
        <MoneyText value={5000} signed />
        <MoneyText value={-5000} signed />
      </>,
    );
    const [due, advance] = container.querySelectorAll('span');
    expect(due!.textContent).toBe('₹50.00');
    expect(due!.className).toMatch(/due/);
    expect(advance!.textContent).toBe('₹50.00');
    expect(advance!.className).toMatch(/advance/);
  });

  it('quantities keep their trade unit, and dates follow the language', () => {
    render(
      <KitProvider language="hi">
        <QtyText value={1250} unit="bori" />
        <DateText value="2026-10-12" />
        <DateText value="2026-10-12T06:30:00Z" time />
      </KitProvider>,
    );
    expect(screen.getByText('1,250 bori')).toBeTruthy();
    expect(screen.getByText('12 अक्तू॰ 2026')).toBeTruthy();
    expect(screen.getByText('12 अक्तू॰ 2026 · 12:00').getAttribute('datetime')).toBe(
      '2026-10-12T06:30:00Z',
    );
  });
});

describe('StatusStamp', () => {
  it('speaks one vocabulary, in each language, with one colour per meaning', () => {
    render(
      <>
        <KitProvider language="hinglish">
          <StatusStamp kind="due" />
        </KitProvider>
        <KitProvider language="en">
          <StatusStamp kind="confirmed" />
        </KitProvider>
        <KitProvider language="hi">
          <StatusStamp kind="difference" />
        </KitProvider>
      </>,
    );
    expect(screen.getByText('Baaki').className).toMatch(/stamp_warn/);
    expect(screen.getByText('Confirmed').className).toMatch(/stamp_ok/);
    expect(screen.getByText('फ़र्क़').className).toMatch(/stamp_danger/);
  });

  it('every stamp has its words in every language', () => {
    for (const language of ['hinglish', 'en', 'hi'] as const)
      for (const kind of Object.keys(stamps) as (keyof typeof stamps)[]) {
        const { container, unmount } = render(
          <KitProvider language={language}>
            <StatusStamp kind={kind} />
          </KitProvider>,
        );
        expect(container.textContent, `${language} ${kind}`).not.toMatch(/^kit\./);
        expect(container.textContent?.trim()).toBeTruthy();
        unmount();
      }
  });
});

describe('KpiTile', () => {
  it('shows the figure, the change and whether that is good', () => {
    render(
      <>
        <KpiTile label="Aaj ki vasooli" value={1500000} before={1000000} />
        <KpiTile label="Baaki udhaar" value={1500000} before={1000000} goodWhen="down" />
        <KpiTile label="Order" kind="count" value={1240} />
      </>,
    );
    const up = screen.getAllByText('50% zyada');
    expect(up[0]!.className).toMatch(/goodChange/);
    expect(up[1]!.className).toMatch(/badChange/);
    expect(screen.getAllByText('₹15,000')).toHaveLength(2);
    expect(screen.getByText('1,240')).toBeTruthy();
  });

  it('a tile with a filter is a pressed-or-not button', async () => {
    const select = vi.fn();
    render(
      <KpiTile
        label="Kam stock"
        kind="count"
        value={12}
        selected
        onSelect={select}
        trend={[1, 4, 2]}
      />,
    );
    const tile = screen.getByRole('button', { name: /Kam stock/ });
    expect(tile.getAttribute('aria-pressed')).toBe('true');
    expect(tile.querySelector('svg polyline')).toBeTruthy();
    await userEvent.click(tile);
    expect(select).toHaveBeenCalledOnce();
  });
});

describe('LedgerTotal', () => {
  it('sits under the double rule with its label', () => {
    const { container } = render(<LedgerTotal label="Kul" value={990000} />);
    expect(container.firstElementChild!.className).toMatch(/ledgerTotal/);
    expect(container.textContent).toBe('Kul₹9,900.00');
  });
});

describe('Pager', () => {
  it('says the range against an exact total, an estimate, or no total', () => {
    const { rerender } = render(
      <Pager offset={0} shown={50} total={{ value: 1240, exact: true }} />,
    );
    expect(screen.getByText('1,240 mein 1–50')).toBeTruthy();
    rerender(<Pager offset={50} shown={50} total={{ value: 12000, exact: false }} />);
    expect(screen.getByText('lagbhag 12,000 mein 51–100')).toBeTruthy();
    rerender(
      <KitProvider language="en">
        <Pager offset={0} shown={20} />
      </KitProvider>,
    );
    expect(screen.getByText('1–20')).toBeTruthy();
  });

  it('previous and next work only when there is somewhere to go, and not while loading', async () => {
    const next = vi.fn();
    const { rerender } = render(<Pager offset={0} shown={50} onNext={next} />);
    expect(screen.getByRole('button', { name: 'Peeche' })).toHaveProperty('disabled', true);
    await userEvent.click(screen.getByRole('button', { name: 'Aage' }));
    expect(next).toHaveBeenCalledOnce();
    rerender(<Pager offset={0} shown={50} onNext={next} busy />);
    expect(screen.getByRole('button', { name: /Aage/ })).toHaveProperty('disabled', true);
  });
});
