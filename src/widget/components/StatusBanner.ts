// Cabecera del panel: nombre del canal y cuántos hay en voz, o el aviso que corresponda.

import type { Strings } from '../../shared/i18n.ts';
import type { PanelView } from '../services/PhoneBoxClient.ts';

export class StatusBanner {
  readonly element: HTMLElement;
  readonly #doc: Document;
  readonly #strings: Strings;

  constructor(doc: Document, strings: Strings) {
    this.#doc = doc;
    this.#strings = strings;
    this.element = doc.createElement('header');
    this.element.className = 'cabecera';
  }

  render(view: PanelView): void {
    if (view.kind === 'conectado' && view.state.canal !== null) {
      const name = this.#span('canal', view.state.canal.nombre);
      const count = this.#span('total', this.#strings.inVoice(view.state.canal.total));
      this.element.className = 'cabecera en-canal';
      this.element.replaceChildren(name, count);
      return;
    }
    const kind = view.kind === 'conectado' ? 'sin-canal' : view.kind;
    this.element.className = `cabecera aviso aviso-${kind}`;
    const messages = {
      'sin-conexion': this.#strings.noConnection,
      cerrado: this.#strings.closed,
      'sin-autorizar': this.#strings.notAuthorized,
      'sin-canal': this.#strings.notInChannel,
    };
    this.element.replaceChildren(this.#span('mensaje', messages[kind]));
  }

  #span(className: string, text: string): HTMLElement {
    const span = this.#doc.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  }
}
