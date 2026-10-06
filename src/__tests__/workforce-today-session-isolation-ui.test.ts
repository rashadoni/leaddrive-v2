// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { toast } from 'sonner';
import { WorkforceWorkbench } from '@/components/workforce/workforce-workbench';
const state = vi.hoisted(() => ({ session: { data: { user: { id: 'synthetic-A', organizationId: 'synthetic-org', role: 'manager' } }, status: 'authenticated' }, t: (key: string, values?: Record<string, unknown>) => values ? key + ':' + JSON.stringify(values) : key, params: new URLSearchParams() }));
vi.mock('next-auth/react', () => ({ useSession: () => state.session }));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => state.t }));
vi.mock('next/navigation', () => ({ useSearchParams: () => state.params }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: {
        children?: ReactNode;
        href: string;
    }) => createElement('a', props, children) }));
vi.mock('@/components/page-description', () => ({ PageDescription: ({ title }: {
        title: string;
    }) => createElement('h1', null, title) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
(globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;
let element: HTMLDivElement, root: ReturnType<typeof createRoot>, fetchMock: ReturnType<typeof vi.fn>;
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
function person(name: string) { return { id: name, name, role: 'AGENT', status: 'NOT_STARTED', workday: null, previousOpenWorkday: null, plan: { state: 'ASSIGNED', source: 'EFFECTIVE_PUBLISHED_SCHEDULE', templateName: 'Synthetic shift', timezone: 'UTC', plannedStartAt: '2026-10-06T09:00:00.000Z', plannedEndAt: '2026-10-06T18:00:00.000Z' }, calendar: { state: 'SCHEDULED', attendanceExpected: true, noShowEligible: true, excused: false }, attendance: { state: 'SCHEDULED_NOT_STARTED', acceptedStartRecorded: false }, exceptions: [{ type: 'NO_SHOW', status: 'OPEN' }], boundaries: {} }; }
function response(name: string, cursor: string | null = null) { return { ok: true, json: async () => ({ success: true, data: { date: '2026-10-06', timezone: 'UTC', scope: 'GRANT', summary: { started: 0, paused: 0, completed: 0, notStarted: 1, previousOpen: 0 }, summaryScope: 'LOADED_PAGE', pagination: { pageSize: 25, nextCursor: cursor }, employeeToday: null, people: [person(name)] } }) }; }
async function render() { await act(async () => { root.render(createElement(WorkforceWorkbench, { view: 'today' })); await new Promise(r => setTimeout(r, 0)); }); }
beforeEach(() => { vi.clearAllMocks(); state.session = { data: { user: { id: 'synthetic-A', organizationId: 'synthetic-org', role: 'manager' } }, status: 'authenticated' }; element = document.createElement('div'); document.body.append(element); root = createRoot(element); fetchMock = vi.fn().mockResolvedValue(response('Synthetic A-only employee')); vi.stubGlobal('fetch', fetchMock); });
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.unstubAllGlobals(); });
function deferred() { let resolve: (x: ReturnType<typeof response>) => void = () => { }, reject: (x: unknown) => void = () => { }; const promise = new Promise<ReturnType<typeof response>>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function settle(d: ReturnType<typeof deferred>, value: ReturnType<typeof response>) { await act(async () => { d.resolve(value); await new Promise(r => setTimeout(r, 0)); }); }
function button(text: string) { const b = Array.from(element.querySelectorAll('button')).find(x => x.textContent === text); expect(b).toBeTruthy(); return b!; }
async function click(text: string) { await act(async () => { button(text).click(); await new Promise(r => setTimeout(r, 0)); }); }
function noOld() { expect(element.textContent).not.toContain('Synthetic A-only employee'); expect(element.textContent).not.toContain('Synthetic late A-only employee'); }
it.each(['principal', 'role', 'organization'])('clears protected rows before new %s response and then renders replacement', async (kind) => {
    await render();
    expect(element.textContent).toContain('Synthetic A-only employee');
    const next = deferred();
    fetchMock.mockImplementation(() => next.promise);
    const user = { ...state.session.data.user, ...(kind === 'principal' ? { id: 'synthetic-B' } : kind === 'role' ? { role: 'viewer' } : { organizationId: 'synthetic-other-org' }) };
    state.session = { ...state.session, data: { user } };
    await render();
    noOld();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await settle(next, response('Synthetic replacement employee'));
    noOld();
    expect(element.textContent).toContain('Synthetic replacement employee');
});
it.each(['loading', 'unauthenticated'])('clears rows during %s, sends no fetch, and reloads after authenticated return', async (status) => {
    await render();
    state.session = { ...state.session, status };
    await render();
    noOld();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(element.querySelector(status === 'loading' ? '[role=status]' : '[role=alert]')).toBeTruthy();
    const next = deferred();
    fetchMock.mockImplementation(() => next.promise);
    state.session = { ...state.session, status: 'authenticated' };
    await render();
    noOld();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await settle(next, response('Synthetic returned employee'));
    expect(element.textContent).toContain('Synthetic returned employee');
});
it('rejects old initial response using distinct deferred old/new requests', async () => {
    const old = deferred(), next = deferred();
    fetchMock.mockReset().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    await render();
    state.session = { ...state.session, data: { user: { ...state.session.data.user, id: 'synthetic-B' } } };
    await render();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await settle(old, response('Synthetic A-only employee'));
    noOld();
    expect(element.querySelector('[role=status]')).toBeTruthy();
    await settle(next, response('Synthetic B-only employee'));
    expect(element.textContent).toContain('Synthetic B-only employee');
    noOld();
});
it('rejects late old pagination and cannot reset new principal pending pagination', async () => {
    const oldPage = deferred(), newPage = deferred();
    fetchMock.mockReset().mockResolvedValueOnce(response('Synthetic A-only employee', 'old-cursor')).mockReturnValueOnce(oldPage.promise).mockResolvedValueOnce(response('Synthetic B-only employee', 'new-cursor')).mockReturnValueOnce(newPage.promise);
    await render();
    await click('managerLoadMore');
    state.session = { ...state.session, data: { user: { ...state.session.data.user, id: 'synthetic-B' } } };
    await render();
    noOld();
    await click('managerLoadMore');
    expect(button('managerLoadingMore').getAttribute('aria-disabled')).toBe('true');
    await settle(oldPage, response('Synthetic late A-only employee'));
    noOld();
    expect(button('managerLoadingMore').getAttribute('aria-disabled')).toBe('true');
    await settle(newPage, response('Synthetic B second employee'));
    expect(element.textContent).toContain('Synthetic B second employee');
    noOld();
});
it('suppresses a late old pagination error toast after principal switch', async () => {
    const oldPage = deferred();
    fetchMock.mockReset().mockResolvedValueOnce(response('Synthetic A-only employee', 'old-cursor')).mockReturnValueOnce(oldPage.promise).mockResolvedValueOnce(response('Synthetic B-only employee'));
    await render();
    await click('managerLoadMore');
    state.session = { ...state.session, data: { user: { ...state.session.data.user, id: 'synthetic-B' } } };
    await render();
    await act(async () => { oldPage.reject(new Error('synthetic-old-failure')); await new Promise(r => setTimeout(r, 0)); });
    expect(toast.error).not.toHaveBeenCalled();
    noOld();
    expect(element.textContent).toContain('Synthetic B-only employee');
});
it('same-scope pagination appends once and retains exhausted control', async () => {
    fetchMock.mockReset().mockResolvedValueOnce(response('Synthetic A-only employee', 'cursor')).mockResolvedValueOnce(response('Synthetic second employee'));
    await render();
    await click('managerLoadMore');
    expect(element.querySelectorAll('article')).toHaveLength(2);
    expect(element.textContent).toContain('Synthetic A-only employee');
    expect(element.textContent).toContain('Synthetic second employee');
    expect(Array.from(element.querySelectorAll('button')).some(x => x.textContent === 'managerLoadMore')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('same-scope refresh replaces rather than appends prior rows', async () => {
    await render();
    const next = deferred();
    fetchMock.mockImplementation(() => next.promise);
    await click('refresh');
    noOld();
    await settle(next, response('Synthetic refreshed employee'));
    expect(element.querySelectorAll('article')).toHaveLength(1);
    expect(element.textContent).toContain('Synthetic refreshed employee');
    noOld();
});
it('role change and return each receive fresh isolated response', async () => {
    await render();
    fetchMock.mockResolvedValueOnce(response('Synthetic viewer employee'));
    state.session = { ...state.session, data: { user: { ...state.session.data.user, role: 'viewer' } } };
    await render();
    noOld();
    expect(element.textContent).toContain('Synthetic viewer employee');
    const next = deferred();
    fetchMock.mockImplementation(() => next.promise);
    state.session = { ...state.session, data: { user: { ...state.session.data.user, role: 'manager' } } };
    await render();
    expect(element.textContent).not.toContain('Synthetic viewer employee');
    noOld();
    await settle(next, response('Synthetic manager refreshed employee'));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(element.textContent).toContain('Synthetic manager refreshed employee');
});
it('same authenticated identity rerender does not reset loaded data', async () => {
    await render();
    state.session = { ...state.session, data: { user: { ...state.session.data.user } } };
    await render();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(element.textContent).toContain('Synthetic A-only employee');
});
it('fresh same-scope refresh can paginate without waiting for abandoned old page', async () => {
    const abandoned = deferred();
    fetchMock.mockReset().mockResolvedValueOnce(response('Synthetic A-only employee', 'old-cursor')).mockReturnValueOnce(abandoned.promise).mockResolvedValueOnce(response('Synthetic refreshed employee', 'fresh-cursor'));
    await render();
    await click('managerLoadMore');
    expect(button('managerLoadingMore').getAttribute('aria-disabled')).toBe('true');
    await click('refresh');
    expect(element.textContent).toContain('Synthetic refreshed employee');
    const stuck = Array.from(element.querySelectorAll('button')).some(x => x.textContent === 'managerLoadingMore' && x.getAttribute('aria-disabled') === 'true');
    expect(stuck).toBe(false);
});
it('old page finally cannot unlock newer page after same-scope refresh', async () => {
    const old = deferred(), next = deferred();
    fetchMock.mockReset().mockResolvedValueOnce(response('Synthetic A-only employee', 'old-cursor')).mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('Synthetic refreshed employee', 'fresh-cursor')).mockReturnValueOnce(next.promise);
    await render();
    await click('managerLoadMore');
    await click('refresh');
    await click('managerLoadMore');
    expect(button('managerLoadingMore').getAttribute('aria-disabled')).toBe('true');
    await settle(old, response('Synthetic late A-only employee'));
    noOld();
    expect(button('managerLoadingMore').getAttribute('aria-disabled')).toBe('true');
    await settle(next, response('Synthetic refreshed second employee'));
    expect(element.textContent).toContain('Synthetic refreshed second employee');
    expect(element.querySelectorAll('article')).toHaveLength(2);
});

function paginationStatus() {
    return element.querySelector('section[aria-labelledby="workforce-manager-today-list"] [role="status"]')?.textContent ?? '';
}
it('keeps native focus on a fast exhausted control and announces committed counts without names', async () => {
    fetchMock.mockReset().mockResolvedValueOnce(response('Synthetic first employee', 'cursor')).mockResolvedValueOnce(response('Synthetic second employee'));
    await render();
    expect(paginationStatus()).toBe('');
    const control = button('managerLoadMore');
    control.focus();
    await click('managerLoadMore');
    expect(document.activeElement).toBe(control);
    expect(control.textContent).toBe('managerListComplete');
    expect(control.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(control.disabled).toBe(false);
    expect(control.getAttribute('aria-disabled')).toBe('true');
    expect(paginationStatus()).toBe('managerLoadMoreResult:{"added":1,"total":2} managerListComplete');
    expect(paginationStatus()).not.toContain('Synthetic');
    await act(async () => { control.click(); control.click(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('guards synchronous double activation and preserves focus while a page is pending', async () => {
    const page = deferred();
    fetchMock.mockReset().mockResolvedValueOnce(response('Synthetic first employee', 'cursor')).mockReturnValueOnce(page.promise);
    await render();
    const control = button('managerLoadMore'); control.focus();
    await act(async () => { control.click(); control.click(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(control);
    expect(control.disabled).toBe(false);
    expect(control.getAttribute('aria-disabled')).toBe('true');
    expect(paginationStatus()).toBe('');
    await settle(page, response('Synthetic second employee', 'next'));
    expect(document.activeElement).toBe(control);
    expect(control.getAttribute('aria-disabled')).toBe('false');
    expect(paginationStatus()).toBe('managerLoadMoreResult:{"added":1,"total":2}');
});
it('does not steal focus when a user leaves the pagination control before completion', async () => {
    const page = deferred();
    fetchMock.mockReset().mockResolvedValueOnce(response('Synthetic first employee', 'cursor')).mockReturnValueOnce(page.promise);
    await render(); await click('managerLoadMore');
    const other = button('refresh'); other.focus();
    await settle(page, response('Synthetic second employee'));
    expect(document.activeElement).toBe(other);
    expect(other.scrollIntoView).not.toHaveBeenCalled();
    expect(paginationStatus()).toContain('"added":1,"total":2');
});
it('releases a failed request for retry without announcing a successful result', async () => {
    fetchMock.mockReset().mockResolvedValueOnce(response('Synthetic first employee', 'cursor')).mockRejectedValueOnce(new Error('synthetic-pagination-failure')).mockResolvedValueOnce(response('Synthetic second employee'));
    await render(); const control = button('managerLoadMore'); control.focus();
    await click('managerLoadMore');
    expect(paginationStatus()).toBe('');
    expect(control.getAttribute('aria-disabled')).toBe('false');
    expect(document.activeElement).toBe(control);
    expect(toast.error).toHaveBeenCalledTimes(1);
    await click('managerLoadMore');
    expect(paginationStatus()).toContain('"added":1,"total":2');
});
it('never announces an incompatible page that the current read rejects', async () => {
    const incompatible = response('Synthetic rejected employee');
    const json = incompatible.json;
    incompatible.json = async () => { const result = await json(); result.data.date = '2026-10-07'; return result; };
    fetchMock.mockReset().mockResolvedValueOnce(response('Synthetic first employee', 'cursor')).mockResolvedValueOnce(incompatible);
    await render(); await click('managerLoadMore');
    expect(element.textContent).not.toContain('Synthetic rejected employee');
    expect(paginationStatus()).toBe('');
    expect(button('managerLoadMore').getAttribute('aria-disabled')).toBe('false');
});
it('announces unique added rows, including accepted empty exhaustion, rather than page size', async () => {
    fetchMock.mockReset().mockResolvedValueOnce(response('Synthetic same employee', 'cursor')).mockResolvedValueOnce(response('Synthetic same employee'));
    await render(); await click('managerLoadMore');
    expect(element.querySelectorAll('article')).toHaveLength(1);
    expect(paginationStatus()).toBe('managerLoadMoreResult:{"added":0,"total":1} managerListComplete');
});
it('clears accepted pagination announcements across refresh and principal changes', async () => {
    fetchMock.mockReset().mockResolvedValueOnce(response('Synthetic first employee', 'cursor')).mockResolvedValueOnce(response('Synthetic second employee')).mockResolvedValue(response('Synthetic replacement employee'));
    await render(); await click('managerLoadMore');
    expect(paginationStatus()).toContain('managerLoadMoreResult');
    await click('refresh');
    expect(paginationStatus()).toBe('');
    state.session = { ...state.session, data: { user: { ...state.session.data.user, id: 'synthetic-B' } } };
    await render();
    expect(paginationStatus()).toBe('');
    expect(element.textContent).not.toContain('managerListComplete');
});
it('deduplicates repeated new IDs inside one page and derives the summary from accepted rows', async () => {
    const duplicated = response('Synthetic repeated employee'); const json = duplicated.json;
    duplicated.json = async () => { const result = await json(); result.data.people.push({ ...result.data.people[0] }); result.data.summary.notStarted = 2; return result; };
    fetchMock.mockReset().mockResolvedValueOnce(response('Synthetic first employee', 'cursor')).mockResolvedValueOnce(duplicated);
    await render(); await click('managerLoadMore');
    expect(element.querySelectorAll('article')).toHaveLength(2);
    expect(paginationStatus()).toBe('managerLoadMoreResult:{"added":1,"total":2} managerListComplete');
});
it('does not count an already loaded working employee twice in the summary', async () => {
    const working = () => { const value = response('Synthetic working employee'); const json = value.json; value.json = async () => { const result = await json(); result.data.people[0].status = 'STARTED'; result.data.summary.started = 1; result.data.summary.notStarted = 0; return result; }; return value; };
    const initial = working(); const initialJson = initial.json;
    initial.json = async () => { const result = await initialJson(); result.data.pagination.nextCursor = 'cursor'; return result; };
    fetchMock.mockReset().mockResolvedValueOnce(initial).mockResolvedValueOnce(working());
    await render(); await click('managerLoadMore');
    expect(element.querySelectorAll('article')).toHaveLength(1);
    const summary = element.querySelector('section[aria-label="dailySummary"]');
    expect(summary?.firstElementChild?.textContent).toBe('1started');
    expect(paginationStatus()).toBe('managerLoadMoreResult:{"added":0,"total":1} managerListComplete');
});
