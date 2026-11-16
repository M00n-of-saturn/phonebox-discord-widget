# Diseño: panel de voz de Discord para PhoneBox

**Fecha:** 2026-11-15
**Estado:** aprobado por el usuario el 2026-11-15

## Para qué

Ver desde el teléfono del escritorio si estoy en un canal de voz de Discord, quién está y quién habla,
y poder silenciarme, ensordecerme o colgar sin cambiar de ventana en la PC.

## Objetivos

- Mostrar el canal de voz actual, sus participantes y quién está hablando, con menos de un segundo de retraso.
- Tres botones que reflejan el estado real: silenciar, ensordecer y colgar.
- Seguir funcionando solo tras reiniciar la PC, cerrar Discord o desconectar el teléfono.
- Cumplir la sección "Seguridad" del `README.md`.

## Fuera de alcance

- Notificaciones, menciones y mensajes (la "opción C"; la estructura queda lista para sumarla).
- Vesktop u otros clientes no oficiales.
- Fotos de perfil, volumen por persona, cambiar de canal o de servidor.

## Lo que haría fracasar el proyecto aunque funcione

- Que el token de la cuenta personal, el secreto de la aplicación o un token de acceso terminen en el
  repositorio, en un registro, en el teléfono o en la configuración de PhoneBox.
- Que un nombre de usuario o de canal malicioso pueda ejecutar código en el widget.
- Que el teléfono pueda pedirle a la PC algo distinto de las tres acciones previstas.

## Restricciones comprobadas

| Hecho | Cómo se comprobó |
|---|---|
| Una aplicación propia obtiene los permisos `rpc`, `rpc.voice.read` y `rpc.voice.write` y puede leer y escribir los ajustes de voz | `spike/discord-rpc-probe.mjs`, pasos 1 a 7 en OK (2026-11-15) |
| Los eventos de "quién habla" y de cambios de participantes llegan al suscribirse con el id del canal | Misma prueba, pasos 8 y 9 en OK dentro de un canal con 7 participantes: 29 eventos de habla y 7 cambios en 20 s (2026-11-15) |
| El agente acepta JSON con forma libre en `POST /api/push/<clave>` y lo entrega intacto, con caducidad `ttl` | Petición de prueba al agente local |
| El widget "Custom HTML" corre en un `iframe` con `sandbox="allow-scripts"`; recibe datos con `phonebox.on('push', fn)` y solo puede pedir `phonebox.run(id)` para ids de accesos directos que ya existan en la configuración | Lectura de `panel/widgets/pc.js` del agente 0.9.10 |
| El widget se entrega como un único bloque de HTML | Catálogo de widgets del agente |

## Enfoques considerados

| Enfoque | Qué ofrece | Por qué sí o no |
|---|---|---|
| A. Solo botones con atajos de teclado | Abrir Discord, silenciar y ensordecer a ciegas | Descartado: no muestra estado y duplica el widget "Discord controls" incluido |
| **B. Panel de voz por la conexión local oficial** | Canal, participantes, quién habla y botones con estado real | **Elegido por el usuario.** Usa una aplicación propia, sin token de cuenta |
| C. B más notificaciones | Además, menciones y mensajes directos | Pospuesto: pide un permiso más y hace pasar contenido de mensajes por el agente |

## Cómo funciona

```
Discord (PC) ──conexión local──> bridge (PC) ──POST /api/push/discord-voice──> agente PhoneBox ──USB──> widget (teléfono)
     ^                              ^                                                                      │
     └── SET_VOICE_SETTINGS ────────┘<── socket local ── ctl <── acceso directo <── phonebox.run(id) ──────┘
```

### Piezas

1. **bridge** (PC, servicio de usuario de systemd). Mantiene la conexión con Discord, traduce sus eventos
   a un estado propio y lo publica en el agente. Escucha órdenes en un socket local.
2. **ctl** (PC, programa de una línea). Lo ejecutan los accesos directos de PhoneBox; envía una orden al
   socket del bridge y termina.
3. **widget** (teléfono). Dibuja el estado que recibe y pide acciones por id. No contiene lógica ni secretos.
4. **shared**. El modelo del estado y su validación, usado por bridge y widget.

### Estado que viaja al teléfono

Clave `discord-voice`, con `ttl` de 15 segundos para que un bridge caído no deje datos viejos en pantalla.

```json
{
  "v": 1,
  "discord": "conectado | cerrado | sin-autorizar",
  "canal": { "nombre": "General", "total": 5 },
  "yo": { "silenciado": false, "ensordecido": false },
  "miembros": [
    { "clave": "a1b2c3d4", "nombre": "Ana", "habla": true, "silenciado": false, "ensordecido": false }
  ]
}
```

- `canal` es `null` fuera de un canal de voz.
- `clave` es un identificador opaco por sesión (resumen del id de Discord con una sal aleatoria que cambia
  en cada arranque); el id real no sale de la PC.
- Como máximo 12 miembros y nombres de hasta 32 caracteres, sin caracteres de control.
- Se publica al cambiar algo, con un máximo de 5 envíos por segundo, y cada 5 segundos como latido.

### Órdenes del teléfono a la PC

Tres accesos directos nuevos en PhoneBox: `discord-mute`, `discord-deafen`, `discord-hangup`, más
`discord-open` para abrir Discord cuando está cerrado. Cada uno ejecuta `ctl` con una palabra fija.
El bridge acepta solo `alternar-silencio`, `alternar-ensordecer` y `colgar`; cualquier otra entrada se rechaza.

El socket vive en `$XDG_RUNTIME_DIR/phonebox-discord-widget.sock` con permisos 0600: solo el propio usuario
puede escribirle y no se abre ningún puerto de red.

La página "Shortcuts" actual muestra todos los accesos directos; se le fija la lista explícita de los 11
existentes para que los cuatro nuevos no aparezcan ahí.

### Cómo se ve

Página nueva "Discord", un widget a pantalla completa en horizontal:

```
┌──────────────────────────────────────────────────────────┐
│  🔊 General                                   5 en voz   │
│                                                          │
│  ● Ana          ○ Bruno 🔇     ○ Carla                   │
│  ○ Diego 🎧     ○ Tú                                     │
│                                                          │
│  [  🎙 Silenciar  ]   [  🎧 Ensordecer  ]   [  ☎ Colgar ]│
└──────────────────────────────────────────────────────────┘
```

- El punto relleno y resaltado marca a quien habla.
- Los botones cambian de color y texto según el estado real ("Silenciado", "Ensordecido").
- Fuera de un canal: "No estás en un canal de voz" y los botones de silenciar y ensordecer siguen activos.
- Discord cerrado: "Discord está cerrado" y un botón "Abrir Discord".
- Sin datos del bridge (caducó el `ttl`): "Sin conexión con la PC".
- Sin fotos de perfil: se usan iniciales, porque el sandbox no debe depender de internet y así no se
  envían direcciones de imágenes al teléfono.

### Secretos y autorización

- Un comando de instalación pide una sola vez el Client ID y el Client Secret (entrada oculta) y guarda el
  secreto en el llavero del sistema (KWallet, por `secret-tool`). El Client ID, que no es secreto, va en
  `~/.config/phonebox-discord-widget/config.json`.
- La primera vez Discord muestra la ventana "Autorizar". El token de refresco resultante se guarda en el
  llavero; el token de acceso vive solo en memoria.
- Si el llavero no está disponible, la instalación se detiene y lo dice; no se cae a un archivo en texto
  plano sin que el usuario lo decida.
- El archivo `.env` queda solo para desarrollo y para la prueba del `spike/`.

### Fallos

| Situación | Comportamiento |
|---|---|
| Discord cerrado | El bridge reintenta cada 5 s y publica `discord: "cerrado"` |
| Token de refresco revocado o caducado | Publica `sin-autorizar`; el widget pide volver a ejecutar la instalación |
| Agente de PhoneBox caído | El bridge sigue conectado a Discord y reintenta publicar |
| Bridge caído | systemd lo reinicia; el estado caduca en 15 s y el widget muestra "Sin conexión con la PC" |
| Dato inesperado de Discord | Se descarta el evento y se registra el tipo, sin contenido |

## Decisiones técnicas (mías, corregibles)

- **TypeScript** con Node 24. Dependencias solo de desarrollo: `typescript` y `esbuild`. Ninguna en ejecución:
  el protocolo de Discord se implementa con módulos de Node, como en la prueba.
- **Build:** `esbuild` genera `dist/bridge.js`, `dist/ctl.js` y `dist/widget.html` (HTML, CSS y JS en un bloque).
- **Instalación:** un script escribe el servicio de systemd, agrega los accesos directos y la página en
  PhoneBox mediante `PUT /api/settings`, con copia previa de la configuración.
- **Pruebas** con `node:test`.

## Pruebas exigidas

- Tramas de Discord: partidas en varios trozos, tamaño inválido, JSON inválido.
- Validación del modelo: campos faltantes, tipos erróneos, más de 12 miembros, nombres largos o con
  caracteres de control.
- Seguridad: un nombre como `<img src=x onerror=...>` se muestra como texto; el socket rechaza órdenes
  fuera de la lista; búsqueda de secretos en el repositorio y en `dist/` sin resultados; `pnpm audit`
  sin altas ni críticas.
- Manual, con el teléfono: los cinco estados de pantalla y los tres botones.
- `docs/amenazas.md` con la matriz de amenazas (activo, vector, impacto, probabilidad, mitigación, evidencia).

## Queda para quien implemente

- Nombres exactos de clases y archivos dentro de la estructura de `src/` ya creada.
- Colores, tamaños y animación del indicador de "habla".
- Cómo simular el DOM en la prueba de XSS sin sumar dependencias pesadas.
