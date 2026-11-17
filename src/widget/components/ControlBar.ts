// Botones de acción. Se crean una sola vez para no perder un toque si llega un estado nuevo a mitad de pulsación.

import type { Strings } from '../../shared/i18n.ts';
import type { PanelView, ShortcutId } from '../services/PhoneBoxClient.ts';

export class ControlBar {
  readonly element: HTMLElement;
  readonly #mute: HTMLElement;
  readonly #deafen: HTMLElement;
  readonly #hangup: HTMLElement;
  readonly #open: HTMLElement;
  readonly #strings: Strings;

  constructor(doc: Document, run: (id: ShortcutId) => void, strings: Strings) {
    this.#strings = strings;
    const make = (className: string, id: ShortcutId, text: string) => {
      const button = doc.createElement('button');
      button.className = `boton ${className}`;
      button.setAttribute('type', 'button');
      button.textContent = text;
      button.addEventListener('click', () => run(id));
      return button;
    };
    this.element = doc.createElement('nav');
    this.element.className = 'controles';
    this.#mute = make('silenciar', 'discord-mute', strings.mute);
    this.#deafen = make('ensordecer', 'discord-deafen', strings.deafen);
    this.#hangup = make('colgar', 'discord-hangup', strings.hangUp);
    this.#open = make('abrir', 'discord-open', strings.openDiscord);
  }

  render(view: PanelView): void {
    if (view.kind === 'cerrado') {
      this.element.replaceChildren(this.#open);
      return;
    }
    if (view.kind !== 'conectado') {
      this.element.replaceChildren();
      return;
    }
    const { yo, canal } = view.state;
    this.#toggle(this.#mute, yo.silenciado, this.#strings.muted, this.#strings.mute);
    this.#toggle(this.#deafen, yo.ensordecido, this.#strings.deafened, this.#strings.deafen);
    if (canal === null) this.element.replaceChildren(this.#mute, this.#deafen);
    else this.element.replaceChildren(this.#mute, this.#deafen, this.#hangup);
  }

  #toggle(button: HTMLElement, active: boolean, onText: string, offText: string): void {
    const text = active ? onText : offText;
    if (button.textContent !== text) button.textContent = text;
    button.classList.toggle('activo', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
