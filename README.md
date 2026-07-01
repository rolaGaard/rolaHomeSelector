🏠 PropCat — Catálogo Inteligente de Propiedades
App web para armar un catálogo compartido de propiedades inmobiliarias.  
Pegás el link de cualquier inmobiliaria en el chat de IA, y PropCat extrae automáticamente la foto, precio, dirección e inmobiliaria.
---
✨ Funcionalidades
🤖 Chat IA — Pegás el link, la IA extrae toda la info
🖼️ Catálogo en mosaico — Fotos con precio superpuesto, responsive
📱 Responsive — 1 columna en celular, hasta 3 en PC
💾 Guardado en GitHub — El catálogo se guarda como JSON en este mismo repo
🔗 Click en foto → abre el link original de la inmobiliaria
---
🚀 Setup en GitHub Pages
1. Crear el repo
```
Nombre: propcat (o el que quieras)
Visibilidad: Public (para GitHub Pages gratis) o Private con GitHub Pro
```
2. Subir el archivo
Subí `index.html` a la raíz del repo
Creá una rama `main` si no existe
3. Activar GitHub Pages
```
Settings → Pages → Source: Deploy from a branch → Branch: main / root → Save
```
URL del site: `https://TU_USUARIO.github.io/propcat/`
4. Configurar la app
Al abrir el site por primera vez, se abre el modal de configuración:
Campo	Dónde obtenerlo
Anthropic API Key	console.anthropic.com → API Keys
GitHub Token	github.com/settings/tokens → New classic token → permiso `repo`
Repositorio	`tu-usuario/propcat` (el mismo repo donde está el `index.html`)
Los datos se guardan en `localStorage` del navegador de cada usuario.
---
👥 Compartir con Jose
Solo compartís la URL de GitHub Pages.  
Cada usuario configura sus propias credenciales en su navegador.  
El catálogo (`catalog.json`) es compartido en el repo — todos ven las mismas propiedades.
> ⚠️ Si editan el catálogo al mismo tiempo puede haber conflicto de SHA en GitHub. Para uso normal (alternado) no hay problema.
---
📁 Estructura del repo
```
propcat/
├── index.html     ← La app completa
└── catalog.json   ← Se crea automáticamente al agregar la primera propiedad
```
---
🏠 Inmobiliarias compatibles
Funciona con cualquier sitio que tenga sus páginas indexadas:
ZonaProp
Argenprop
Mercado Libre Inmuebles
L.J. Ramos
RE/MAX
Toribio Achaval
Bullrich Inmobiliaria
Cualquier otro con página pública
---
🔑 Notas de seguridad
Las API keys se guardan solo en el `localStorage` del navegador (no en el repo)
El `catalog.json` es un archivo JSON plano y público si el repo es público
No guardes información sensible personal en las propiedades
