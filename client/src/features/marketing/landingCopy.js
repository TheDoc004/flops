/**
 * Landing copy — English + Spanish.
 * Keep claims honest: nutrition logging + gym logger are live;
 * correlated nutrition↔training insight is vision (Phase 3), not shipped.
 */

export const LANDING_LANGS = ['en', 'es'];

/** Flip to true when real quotes exist. Never invent testimonials. */
export const SHOW_SOCIAL_PROOF = false;

export const copy = {
  en: {
    metaTitle: 'Flops · free nutrition notebook',
    metaDescription:
      'Flops is a free personal nutrition notebook. Log meals as easily as putting on flip-flops. Built by Diego Ramirez in San Diego.',
    brandAria: 'Flops home',
    langSwitch: 'Español',
    langSwitchAria: 'Ver en español',
    signIn: 'Sign in',
    startFree: 'Start free',
    howItWorksCta: 'How it works',

    heroBrand: 'Flops',
    heroLine:
      'Nutrition should be as easy to log as putting on a pair of flip-flops in the morning.',
    heroSupport:
      'A personal notebook for meals, macros, and training. Free for the person logging. Built by one student in San Diego.',

    missionTitle: 'Free for the eater',
    missionBody: [
      'Nutrition and health tracking should be free and accessible for the person writing the log. Cost should not sit on the eater.',
      'Coaches and tasteful sponsors (think community brands, not ads every two seconds on your log) can carry the economics later. For now Diego sponsors Flops himself. It is cheap to run.',
      'Hard-ish mission: free forever for individuals. Growth first. Income later, without selling food data, dark patterns, or ads on the page where you write.',
    ],

    howTitle: 'How it works',
    howSteps: [
      {
        title: 'Start free with email',
        body: 'We send a six-digit code. No password to forget. Your notebook stays on your account.',
      },
      {
        title: 'Write what you ate',
        body: 'Log a recipe, add ingredients from your library, or ask AI to estimate when that is faster. Tick off supplements. Log lifts in Training when you train.',
      },
      {
        title: 'Flip the day when you mean to',
        body: 'Midnight does not jump you into tomorrow. The page stays put until you turn it.',
      },
    ],

    todayTitle: 'What is live today',
    todayBody:
      'Simple nutrition logging is the heart of Flops: meals, macros, recipes, ingredients, weight, and supplements. Training has its own gym dashboard (templates, schedule, sets, progress). Nutrition and training stay separate for now so each side works well on its own.',
    visionTitle: 'Where it is heading',
    visionBody:
      'Long term, nutrition and training belonging in one notebook should help you see correlations, like progressive overload next to intake. That bridge is not live yet. We will not pretend it is.',

    aboutTitle: 'About Diego',
    aboutBody: [
      'Diego Ramirez is a MIS student at San Diego State University (formerly engineering). He is big on nutrition and loves working out. Born in San Juan, Puerto Rico; middle school through high school in the Bay Area; lives in San Diego. Fourth year at SDSU, planning to graduate Fall 2027.',
      'He started Flops this past summer as a broke college student who did not want to pay for nutrition tracking. Apps like MyFitnessPal felt high-margin, paywalled, frictiony, and over-engineered. So he built a notebook for himself first.',
      'Now he is opening it to others: future clients, coaches who struggle to stay on top of clients, and family sharing later. Built by one person, early, already bigger than him, and open to help. Honest, not fake-enterprise.',
    ],

    closeTitle: 'Open your notebook.',
    closeBody: 'Customizable. Tailored to how you log. Free for individuals.',
    closeCta: 'Start free',

    socialTitle: 'From people who use it',
    socialNote: 'Quotes will appear here when friends and early users share them. No fake reviews.',

    footerRights: 'Flops',
    footerTerms: 'Terms',
    footerPrivacy: 'Privacy',
    footerComingSoon: 'Coming soon',
    footerContact: 'Contact',
    footerPhone: '925-286-6097',
    footerPromise: 'No ads on your log. We do not sell your food data.',
  },

  es: {
    metaTitle: 'Flops · cuaderno de nutrición gratis',
    metaDescription:
      'Flops es un cuaderno personal de nutrición, gratis. Registrar comidas tan fácil como ponerse las chancletas. Hecho por Diego Ramirez en San Diego.',
    brandAria: 'Inicio de Flops',
    langSwitch: 'English',
    langSwitchAria: 'View in English',
    signIn: 'Entrar',
    startFree: 'Empieza gratis',
    howItWorksCta: 'Cómo funciona',

    heroBrand: 'Flops',
    heroLine:
      'Registrar tu nutrición debería ser tan fácil como ponerte las chancletas en la mañana.',
    heroSupport:
      'Un cuaderno personal para comidas, macros y entrenamiento. Gratis para quien escribe el registro. Hecho por un estudiante en San Diego.',

    missionTitle: 'Gratis para quien come',
    missionBody: [
      'El seguimiento de nutrición y salud debería ser gratis y accesible para la persona que anota. El costo no debería caer sobre quien come.',
      'Más adelante, coaches y patrocinadores con buen gusto (marcas de la comunidad fitness, no anuncios cada dos segundos en tu registro) pueden sostener la economía. Por ahora Diego costea Flops él mismo. Es barato de mantener.',
      'Misión firme: gratis para siempre para individuos. Primero crecer. Después ingreso, sin vender datos de comida, sin trucos oscuros y sin anuncios en la página donde escribes.',
    ],

    howTitle: 'Cómo funciona',
    howSteps: [
      {
        title: 'Empieza gratis con tu correo',
        body: 'Te mandamos un código de seis dígitos. Sin contraseña que olvidar. Tu cuaderno queda en tu cuenta.',
      },
      {
        title: 'Anota lo que comiste',
        body: 'Registra una receta, añade ingredientes de tu biblioteca, o pide a la IA una estimación cuando eso sea más rápido. Marca suplementos. En Entrenamiento anota tus series cuando entrenes.',
      },
      {
        title: 'Pasa de día cuando tú quieras',
        body: 'La medianoche no te empuja al día siguiente. La página se queda hasta que tú la pases.',
      },
    ],

    todayTitle: 'Qué hay hoy',
    todayBody:
      'El corazón de Flops es un registro simple de nutrición: comidas, macros, recetas, ingredientes, peso y suplementos. El entrenamiento tiene su propio panel de gym (plantillas, horario, series, progreso). Por ahora nutrición y entrenamiento van por separado, para que cada lado funcione bien solo.',
    visionTitle: 'Hacia dónde va',
    visionBody:
      'A largo plazo, tener nutrición y entrenamiento en el mismo cuaderno debería ayudarte a ver correlaciones, como la sobrecarga progresiva junto a lo que comes. Ese puente todavía no está vivo. No vamos a fingir que sí.',

    aboutTitle: 'Sobre Diego',
    aboutBody: [
      'Diego Ramirez estudia MIS en San Diego State University (antes ingeniería). Le importa mucho la nutrición y le encanta entrenar. Nació en San Juan, Puerto Rico; hizo la secundaria en el Área de la Bahía; vive en San Diego. Va en su cuarto año en SDSU y planea graduarse en otoño de 2027.',
      'Empezó Flops este verano pasado como estudiante corto de dinero que no quería pagar por apps de nutrición. Cosas como MyFitnessPal se sentían caras, con muros de pago, fricción y demasiada ingeniería. Así que se hizo un cuaderno para él primero.',
      'Ahora lo abre a otras personas: futuros clientes, coaches que no dan abasto con sus atletas, y más adelante compartir en familia. Hecho por una sola persona, temprano, ya más grande que él, y abierto a ayuda. Honesto, no de empresa fingida.',
    ],

    closeTitle: 'Abre tu cuaderno.',
    closeBody: 'Personalizable. A tu manera de anotar. Gratis para individuos.',
    closeCta: 'Empieza gratis',

    socialTitle: 'De quien lo usa',
    socialNote:
      'Aquí aparecerán citas cuando amigos y usuarios tempranos las compartan. Sin reseñas inventadas.',

    footerRights: 'Flops',
    footerTerms: 'Términos',
    footerPrivacy: 'Privacidad',
    footerComingSoon: 'Pronto',
    footerContact: 'Contacto',
    footerPhone: '925-286-6097',
    footerPromise: 'Sin anuncios en tu registro. No vendemos tus datos de comida.',
  },
};

export function langFromPath(pathname) {
  if (pathname === '/es' || pathname.startsWith('/es/')) return 'es';
  return 'en';
}

export function pathForLang(lang) {
  return lang === 'es' ? '/es' : '/';
}
