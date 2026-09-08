import assert from "node:assert/strict";
import test, { before } from "node:test";
import * as React from "react";
import { createElement, act } from "react";
import CatalogPicker from "./catalog-picker";
import { Window } from "happy-dom";

const browser = new Window({ url: "http://localhost" });
Object.assign(globalThis, {
  React,
  window: browser,
  document: browser.document,
  HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement,
  Event: browser.Event,
  MouseEvent: browser.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
});

let createRoot: typeof import("react-dom/client")["createRoot"];
before(async () => { ({ createRoot } = await import("react-dom/client")); });

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new browser.Event("input", { bubbles: true }) as unknown as Event);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 280)); });
}

test("picker reports an empty result and selecting a named result changes selected IDs", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let selected: string[] = [];
  await act(async () => root.render(createElement(CatalogPicker, {
    label: "Places", selectedIds: [], onChange: (ids) => { selected = ids; },
    search: async (query) => query === "Rainier" ? [{ id: "r", name: "Mount Rainier" }] : [],
  })));
  const input = host.querySelector("input")!;
  assert.equal(host.querySelector("label")?.htmlFor, input.id);
  await type(input, "missing");
  assert.match(host.textContent!, /No matches/);
  await type(input, "Rainier");
  const result = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Mount Rainier"))!;
  await act(async () => result.click());
  assert.deepEqual(selected, ["r"]);
  await act(async () => root.unmount()); host.remove();
});

test("a slow old search cannot replace the current query's results", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let resolveOld!: (value: { id: string; name: string }[]) => void;
  await act(async () => root.render(createElement(CatalogPicker, {
    label: "Routes", selectedIds: [], onChange: () => {},
    search: (query) => query === "old" ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve([{ id: "new", name: "New route" }]),
  })));
  const input = host.querySelector("input")!;
  await type(input, "old");
  await type(input, "new");
  await act(async () => resolveOld([{ id: "old", name: "Old route" }]));
  assert.match(host.textContent!, /New route/);
  assert.doesNotMatch(host.textContent!, /Old route/);
  await act(async () => root.unmount()); host.remove();
});
