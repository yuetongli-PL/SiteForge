// @ts-check

export {
  buildSourceNote,
  rewriteMarkdownLinks,
} from './resolve-skill-input.mjs';
import { firstNonEmpty, slugifyAscii } from '../../shared/normalize.mjs';
import { resolveSourceInputs } from './resolve-skill-input.mjs';

export async function resolveSkillSourceInputs(url, options) {
  const resolved = await resolveSourceInputs(url, options);
  return {
    ...resolved,
    findPageByKind: (kind) => (resolved.pagesDocument?.pages ?? []).find((page) => page.kind === kind) ?? null,
    findPageById: (pageId) => (resolved.pagesDocument?.pages ?? []).find((page) => page.pageId === pageId) ?? null,
    rewriteMarkdownLinks: (markdown, sourceFilePath, outputFilePath) => (
      resolved.rewriteMarkdownLinks(markdown, sourceFilePath, outputFilePath, resolved.mapToKbPath, resolved.warnings)
    ),
    buildSourceNote: (title, outputFilePath, sourceLinks) => (
      resolved.buildSourceNote(title, outputFilePath, sourceLinks)
    ),
    resolveBookDownloadName: (book) => slugifyAscii(firstNonEmpty([book?.bookTitle, book?.title, 'book']), 'book'),
    rawDirToOriginalPath: resolved.rawToOriginalPath,
  };
}
