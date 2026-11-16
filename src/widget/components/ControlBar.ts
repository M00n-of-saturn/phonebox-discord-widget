// Botones de acción. Se crean una sola vez para no perder un toque si llega un estado nuevo a mitad de pulsación.

import type { PanelView, ShortcutId } from '../services/PhoneBoxClient.ts';

export class ControlBar {
  readonly element: HTMLElement;
  readonly #mute: HTMLElement;
  readonly #deafen: HTMLElement;
  readonly #hangup: HTMLElement;
  readonly #open: HTMLElement;

  constructor(doc: Document, run: (id: ShortcutId) => void) {
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
    this.#mute = make('silenciar', 'discord-mute', 'Silenciar');
    this.#deafen = make('ensordecer', 'discord-deafen', 'Ensordecer');
    this.#hangup = make('colgar', 'discord-hangup', 'Colgar');
    this.#open = make('abrir', 'discord-open', 'Abrir Discord');
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
    this.#toggle(this.#mute, yo.silenciado, 'Silenciado', 'Silenciar');
    this.#toggle(this.#deafen, yo.ensordecido, 'Ensordecido', 'Ensordecer');
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
