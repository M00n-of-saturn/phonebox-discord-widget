// Panel completo: cabecera, participantes y botones. Solo dibuja; no guarda estado propio.

import type { PanelView, PhoneBoxClient } from '../services/PhoneBoxClient.ts';
import { ControlBar } from './ControlBar.ts';
import { MemberList } from './MemberList.ts';
import { StatusBanner } from './StatusBanner.ts';

export class VoicePanel {
  readonly #root: HTMLElement;
  readonly #banner: StatusBanner;
  readonly #members: MemberList;
  readonly #controls: ControlBar;

  constructor(doc: Document, root: HTMLElement, client: PhoneBoxClient) {
    this.#root = root;
    this.#banner = new StatusBanner(doc);
    this.#members = new MemberList(doc);
    this.#controls = new ControlBar(doc, (id) => client.run(id));
    root.classList.add('panel');
    root.replaceChildren(this.#banner.element, this.#members.element, this.#controls.element);
  }

  render(view: PanelView): void {
    this.#root.dataset.vista = view.kind;
    this.#banner.render(view);
    this.#members.render(view.kind === 'conectado' ? view.state.miembros : []);
    this.#controls.render(view);
  }
}
