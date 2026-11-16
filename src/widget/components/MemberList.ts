// Cuadrícula de participantes: inicial, nombre e indicadores. Todo el texto entra con textContent.

import type { Member } from '../../shared/models/VoiceState.ts';

type SegmenterLike = { segment(text: string): Iterable<{ segment: string }> };

function firstGrapheme(text: string): string {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, opts?: object) => SegmenterLike }).Segmenter;
  if (Segmenter) {
    for (const { segment } of new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) return segment;
  }
  return Array.from(text)[0] ?? '?';
}

/** Primera letra visible en mayúscula; los nombres ya vienen saneados y nunca vacíos. */
export function initialOf(name: string): string {
  return firstGrapheme(name.trim() || '?').toLocaleUpperCase();
}

export class MemberList {
  readonly element: HTMLElement;
  readonly #doc: Document;

  constructor(doc: Document) {
    this.#doc = doc;
    this.element = doc.createElement('ul');
    this.element.className = 'miembros';
  }

  render(members: Member[]): void {
    this.element.replaceChildren(...members.map((member) => this.#row(member)));
  }

  #row(member: Member): HTMLElement {
    const row = this.#doc.createElement('li');
    row.className = 'miembro';
    row.dataset.clave = member.clave;
    if (member.habla) row.classList.add('habla');
    if (member.silenciado) row.classList.add('silenciado');
    if (member.ensordecido) row.classList.add('ensordecido');

    const avatar = this.#span('inicial', initialOf(member.nombre));
    avatar.setAttribute('aria-hidden', 'true');
    const name = this.#span('nombre', member.nombre);
    row.append(avatar, name);
    if (member.ensordecido) row.append(this.#indicator('indicador-ensordecido', 'ensordecido'));
    else if (member.silenciado) row.append(this.#indicator('indicador-silencio', 'silenciado'));
    return row;
  }

  #indicator(className: string, label: string): HTMLElement {
    const icon = this.#span(`indicador ${className}`, '');
    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-label', label);
    return icon;
  }

  #span(className: string, text: string): HTMLElement {
    const span = this.#doc.createElement('span');
    span.className = className;
    span.textContent = text;
    return span;
  }
}
