import assert from "node:assert/strict";
import test, { before } from "node:test";
import * as React from "react";
import { act, createElement } from "react";
import { Window } from "happy-dom";
import { useCatalogSearch, SEARCH_SLOW_MS, SEARCH_TIMEOUT_MS } from "./use-catalog-search";
import type { CatalogPage } from "./catalog-results";

const browser = new Window({ url: "http://localhost" });
Object.assign(globalThis, { React, window: browser, document: browser.document, IS_REACT_ACT_ENVIRONMENT: true });
let createRoot: typeof import("react-dom/client")["createRoot"];
before(async () => { ({ createRoot } = await import("react-dom/client")); });

const empty: CatalogPage = { hits: [], counts: { all: 0, destinations: 0, routes: 0, areas: 0, lists: 0 }, total: 0, page: 1, pageSize: 12 };
function deferred() {
  let resolve!: (data: CatalogPage) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<CatalogPage>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function mount(request: (search: string) => Promise<CatalogPage>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let state!: ReturnType<typeof useCatalogSearch>;
  function Probe({ search, active }: { search: string; active: boolean }) {
    state = useCatalogSearch(search, active, request);
    return null;
  }
  return {
    get state() { return state; },
    render: (search: string, active = true) => act(async () => root.render(createElement(Probe, { search, active }))),
    close: async () => { await act(async () => root.unmount()); host.remove(); },
  };
}

test("search shows loading immediately, settles empty results, and does not loop", async () => {
  const response = deferred();
  let calls = 0;
  const view = await mount(() => { calls++; return response.promise; });
  try {
    await view.render("q=rainier");
    assert.equal(view.state.loading, true);
    await act(async () => response.resolve(empty));
    assert.equal(view.state.loading, false);
    assert.equal(view.state.data?.total, 0);
    await view.render("q=rainier");
    assert.equal(calls, 1);
  } finally { await view.close(); }
});

test("old responses cannot overwrite a newer query or a cleared view", async () => {
  const old = deferred();
  const current = deferred();
  const view = await mount((query) => query === "q=old" ? old.promise : current.promise);
  try {
    await view.render("q=old");
    await view.render("q=new");
    await act(async () => current.resolve({ ...empty, total: 2 }));
    await act(async () => old.reject(new Error("old request failed")));
    assert.equal(view.state.data?.total, 2);
    assert.equal(view.state.error, "");
    await view.render("", false);
    assert.equal(view.state.data, null);
    assert.equal(view.state.loading, false);
  } finally { await view.close(); }
});

test("failure is query-specific and retry returns to loading before success", async () => {
  const retry = deferred();
  let calls = 0;
  const view = await mount(() => ++calls === 1 ? Promise.reject(new Error("offline")) : retry.promise);
  try {
    await view.render("q=rainier");
    assert.match(view.state.error, /try again/);
    await act(async () => view.state.retry());
    assert.equal(view.state.loading, true);
    assert.equal(view.state.error, "");
    await act(async () => retry.resolve(empty));
    assert.equal(view.state.loading, false);
    assert.equal(calls, 2);
  } finally { await view.close(); }
});

test("slow searches explain the delay and time out without accepting a late response", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const response = deferred();
  const view = await mount(() => response.promise);
  try {
    await view.render("q=slow");
    await act(async () => t.mock.timers.tick(SEARCH_SLOW_MS));
    assert.equal(view.state.slow, true);
    await act(async () => t.mock.timers.tick(SEARCH_TIMEOUT_MS - SEARCH_SLOW_MS));
    assert.equal(view.state.loading, false);
    assert.match(view.state.error, /longer than expected/);
    await act(async () => response.resolve(empty));
    assert.equal(view.state.data, null);
    assert.match(view.state.error, /longer than expected/);
  } finally { await view.close(); }
});
