# Batalla Naval — Empresas

Juego de Batalla Naval en el navegador (HTML + CSS + JavaScript, sin dependencias ni build).
Las flotas son empresas: Apple, Microsoft, Amazon, Google, NVIDIA, Saudi Aramco y Tesla.

## Cómo jugar

Abre `index.html` en el navegador (doble clic o sirviendo la carpeta con cualquier servidor estático, por ejemplo `npx serve .`).

- **Modos:** 2 jugadores en el mismo dispositivo (con pantalla de privacidad entre turnos) o contra la CPU (fácil, medio o difícil).
- **Tableros:** normal 10×10 o rápida 8×8 con barcos más cortos.
- **Barcos separados:** opción para que los barcos no puedan tocarse, ni en diagonal. Al hundir un barco, las casillas de alrededor se marcan como descartadas.
- **Disparo extra al acertar:** opción para volver a disparar cada vez que tocas o hundes un barco (también aplica a la CPU).
- **Colocación:** elige un barco, gira con `R` y haz clic en el tablero. Haz clic en un barco ya colocado (en el tablero o en la lista) para moverlo. También hay botones *Aleatorio* y *Limpiar*.
- **Teclado:** flechas para moverte por el tablero, `Enter`/`Espacio` para colocar o disparar, `R` para girar, `M` para la ayuda de puntería.
- **Guardado automático:** la partida se guarda en el navegador. Con el botón *Inicio* puedes salir y luego pulsar *Continuar partida*.
- **Récord:** se guardan tus victorias y derrotas contra la CPU por dificultad, tu racha de victorias y tu mejor victoria (menos disparos y más rápida) en cada tamaño de tablero. Al superar una marca se destaca como nuevo récord personal.
- **Ayuda de puntería:** el botón *Ayuda* (o la tecla `M`) colorea el tablero enemigo según la probabilidad de que haya un barco en cada casilla, calculada sólo con tus disparos y los barcos que siguen a flote.
- **Pausa en segundo plano:** si cambias de app o de pestaña durante el turno de la CPU, espera a que vuelvas para disparar.
- **Ayudas visuales:** mira de fila y columna al apuntar, último disparo resaltado, tamaño y número de barcos enemigos que siguen a flote, y cada barco hundido con el color de su empresa.
- **Historial de disparos:** lista desplegable con cada disparo de la partida.
- **Tableros finales:** al terminar puedes ver dónde estaban todos los barcos de ambas flotas.
- **Estadísticas finales:** disparos, precisión, mejor racha de aciertos y duración de la batalla.
- **Instalable y sin conexión:** servido por http/https (por ejemplo GitHub Pages), el juego se puede instalar en el teléfono y funciona sin internet.
- **Extras:** música y efectos generados con Web Audio, vibración en móviles, texto grande, pantalla completa y tres colores de acento.

## Estructura

| Archivo | Contenido |
| --- | --- |
| `index.html` | Pantallas: inicio, pasa el dispositivo, colocación, batalla y victoria |
| `styles.css` | Estilos y animaciones |
| `game.js` | Lógica del juego, IA de la CPU, guardado, audio y render |
| `sw.js` | Service worker: copia local para jugar sin conexión |
| `manifest.webmanifest`, `icons/` | Datos e iconos para instalar el juego |

### IA de la CPU

- **Fácil:** dispara al azar y sólo a veces persigue un impacto.
- **Medio:** caza alrededor de cada impacto, sigue la línea cuando dos impactos están alineados y busca en patrón de tablero de ajedrez.
- **Difícil:** mapa de probabilidad; para cada barco que sigue a flote cuenta cuántas posiciones posibles cubren cada casilla y dispara a la más probable.
