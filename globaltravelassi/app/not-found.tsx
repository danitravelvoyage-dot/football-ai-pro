// Unmatched URLs (and unknown service pages, rewritten by the middleware) render here with a real 404 status. The
// page reads the locale from the x-locale header that the middleware sets, so it is shown in the visitor's language.
export { default } from "./[locale]/not-found";
