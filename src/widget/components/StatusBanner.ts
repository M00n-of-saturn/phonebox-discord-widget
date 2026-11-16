// Cabecera del panel: nombre del canal y cuántos hay en voz, o el aviso que corresponda.

import type { PanelView } from '../services/PhoneBoxClient.ts';

export const MESSAGES = {
  'sin-conexion': 'Sin conexión con la PC',
  cerrado: 'Discord está cerrado',
  'sin-autorizar': 'Falta autorizar: ejecuta "pnpm run setup" en la PC',
  'sin-canal': 'No estás en un canal de voz',
} as const;

export class StatusBanner {
  readonly element: HTMLElement;
  readonly #doc: Document;

  constructor(doc: Document) {
    this.#doc = doc;
    this.element = doc.createElement('header');
    this.element.className = 'cabecera';
  }

  render(view: PanelView): void {
    if (view.kind === 'conectado' && view.state.canal !== null) {
      const name = this.#span('canal', view.state.canal.nombre);
      const count = this.#span('total', `${view.state.canal.total} en voz`);
      this.element.className = 'cabecera en-canal';
      this.element.replaceChildren(name, count);
      return;
    }
    const kind = view.kind === 'conectado' ? 'sin-canal' : view.kind;
    this.element.className = `cabecera aviso aviso-${kind}`;
    this.element.replaceChildren(this.#span('mensaje', MESSAGES[kind]));
  }

  #span(className: string, text: string): HTMLElement {
    const span = this.#doc.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  }
}
