import { bootstrapApplication } from '@angular/platform-browser'

const printing = new URLSearchParams(window.location.search).get('print') === '1'
if (printing) document.body.classList.add('print-host')
// Окну PDF не нужны маршруты и редакторы основного интерфейса.
const application = printing
  ? import('./app/print-host.component').then(({ PrintHostComponent }) =>
      bootstrapApplication(PrintHostComponent),
    )
  : Promise.all([import('./app/app'), import('./app/app.config')]).then(
      ([{ App }, { appConfig }]) => bootstrapApplication(App, appConfig),
    )
application.catch((err) => console.error(err))
