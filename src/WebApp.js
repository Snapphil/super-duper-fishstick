/**
 * HERMES — WebApp.gs
 * Minimal handler so appsscript.json webapp config has a valid entry point.
 */

function doGet() {
  return ContentService.createTextOutput('Hermes')
    .setMimeType(ContentService.MimeType.TEXT);
}
