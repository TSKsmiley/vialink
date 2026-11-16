// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// Connecting without the chooser and reconnecting after an unplug (plan
// Phase 10), through the whole app on a fake navigator.hid whose keyboard is
// a simulated KLOR behind the real WebHID transport.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SimulatedKeyboard } from "../core/sim/simulatedKeyboard.ts";
import { App } from "./App.tsx";

const definition = new Uint8Array(
  readFileSync(resolve(process.cwd(), "fixtures/definitions/klor.vial.json.xz")),
);

function klor() {
  return new SimulatedKeyboard({
    info: { productName: "Klor", vendorId: 0xfc32, productId: 0x0287 },
    compressedDefinition: definition,
    rows: 8,
    cols: 6,
    layers: 4,
    unlocked: true,
  });
}

/** An HIDDevice whose raw-HID interface answers like the simulated board. */
class FakeHidDevice extends EventTarget {
  opened = false;
  readonly productName: string;
  readonly vendorId: number;
  readonly productId: number;
  readonly collections = [{ usagePage: 0xff60, usage: 0x61 }];
  constructor(private readonly sim: SimulatedKeyboard) {
    super();
    ({ productName: this.productName, vendorId: this.vendorId, productId: this.productId } = sim.info);
  }
  /** Set when unplugged: Chrome refuses to open a device that is gone. */
  gone = false;
  async open() {
    if (this.gone) throw new DOMException("Failed to open the device.", "NotAllowedError");
    await this.sim.open();
    this.opened = true;
  }
  async close() {
    this.opened = false;
  }
  async sendReport(_reportId: number, data: Uint8Array) {
    const reply = await this.sim.send(new Uint8Array(data));
    const event = Object.assign(new Event("inputreport"), { data: new DataView(reply.slice().buffer) });
    setTimeout(() => this.dispatchEvent(event));
  }
}

/** navigator.hid with devices the site already has permission for. */
class FakeHid extends EventTarget {
  devices: FakeHidDevice[] = [];
  async getDevices() {
    return [...this.devices];
  }
  async requestDevice() {
    return [];
  }
  plug(device: FakeHidDevice) {
    this.devices.push(device);
    this.dispatchEvent(Object.assign(new Event("connect"), { device }));
  }
  unplug(device: FakeHidDevice) {
    this.devices = this.devices.filter((d) => d !== device);
    device.opened = false;
    device.gone = true;
    this.dispatchEvent(Object.assign(new Event("disconnect"), { device }));
  }
}

let hid: FakeHid;
beforeEach(() => {
  hid = new FakeHid();
  Object.defineProperty(navigator, "hid", { value: hid, configurable: true });
});
afterEach(() => {
  cleanup();
  delete (navigator as unknown as Record<string, unknown>).hid;
  localStorage.clear();
});

const editorShown = () => screen.findByRole("tab", { name: "Keymap" }, { timeout: 5000 });

describe("connecting without the chooser", () => {
  it("connects on its own to the one keyboard the site already may open", async () => {
    hid.devices.push(new FakeHidDevice(klor()));
    render(<App />);
    expect(await editorShown()).toBeTruthy();
  });

  it("offers each remembered keyboard as a button when there are several", async () => {
    const other = new SimulatedKeyboard({
      info: { productName: "Corne", vendorId: 0x4653, productId: 0x0001 },
      compressedDefinition: definition,
      rows: 8,
      cols: 6,
      layers: 4,
    });
    hid.devices.push(new FakeHidDevice(klor()), new FakeHidDevice(other));
    render(<App />);
    expect(await screen.findByRole("button", { name: "Connect Klor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Corne" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Another keyboard…" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect Corne" }));
    expect(await editorShown()).toBeTruthy();
  });

  it("waits for an unplugged keyboard and reconnects when it is back", async () => {
    const sim = klor();
    const first = new FakeHidDevice(sim);
    hid.devices.push(first);
    render(<App />);
    await editorShown();

    act(() => hid.unplug(first));
    expect(await screen.findByRole("heading", { name: "Klor was unplugged" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Plug it back in/);

    // The browser hands out a new HIDDevice object for the same keyboard.
    act(() => hid.plug(new FakeHidDevice(sim)));
    expect(await editorShown()).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Klor was unplugged" })).toBeNull();
  });

  it("stops waiting when asked, and then leaves a returning keyboard alone", async () => {
    const sim = klor();
    const first = new FakeHidDevice(sim);
    hid.devices.push(first);
    render(<App />);
    await editorShown();

    act(() => hid.unplug(first));
    fireEvent.click(await screen.findByRole("button", { name: "Stop waiting" }));
    expect(await screen.findByRole("heading", { name: "Configure your Vial keyboard" })).toBeTruthy();

    act(() => hid.plug(new FakeHidDevice(sim)));
    expect(await screen.findByRole("button", { name: "Connect Klor" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Keymap" })).toBeNull();
  });
});
