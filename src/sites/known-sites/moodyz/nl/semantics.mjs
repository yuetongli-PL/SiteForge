export function createMoodyzNlSemantics(deps) {
  const {
    INTENT_LANGUAGE_LABELS,
    ELEMENT_KIND_LABELS,
    ZH_STATUS_QUERY_EXAMPLES,
    createSha256,
    ZH_SEARCH_VERBS,
    ZH_OPEN_VERBS,
  } = deps;

  return {
    siteKey: 'moodyz',
    intentLabels: {
      ...INTENT_LANGUAGE_LABELS,
      'search-work': {
        canonical: '鎼滅储浣滃搧',
        aliases: ['鎼滅储浣滃搧', '鏌ユ壘浣滃搧', '鎼滀綔鍝?', '鎵句綔鍝?', '鎼滅储鐣彿', '鏌ユ壘鐣彿'],
      },
      'open-work': {
        canonical: '鎵撳紑浣滃搧',
        aliases: ['鎵撳紑浣滃搧', '鏌ョ湅浣滃搧', '杩涘叆浣滃搧', '鎵撳紑褰辩墖', '鏌ョ湅褰辩墖', '鎵撳紑鐣彿'],
      },
      'open-actress': {
        canonical: '鎵撳紑濂充紭椤?',
        aliases: ['鎵撳紑濂充紭椤?', '鏌ョ湅濂充紭', '杩涘叆濂充紭椤?', '鎵撳紑婕斿憳椤?', '鏌ョ湅濂充紭椤?'],
      },
    },
    elementLabels: {
      ...ELEMENT_KIND_LABELS,
      'content-link-group': {
        canonical: '浣滃搧',
        aliases: ['浣滃搧', '褰辩墖', '鐣彿', '浣滃搧璇︽儏', '浣滃搧椤?'],
      },
      'author-link-group': {
        canonical: '濂充紭',
        aliases: ['濂充紭', '婕斿憳', '濂充紭椤?', '濂充紭璇︽儏', '婕斿憳椤?'],
      },
      'search-form-group': {
        canonical: '鎼滅储浣滃搧',
        aliases: ['鎼滅储浣滃搧', '鏌ユ壘浣滃搧', '鎼滀綔鍝?', '鎵句綔鍝?'],
      },
      'category-link-group': {
        canonical: '浣滃搧鍒楄〃',
        aliases: ['浣滃搧鍒楄〃', '鎸夋棩鏈?', '鎸夊垎绫?', '鍒楄〃', '鎼滅储缁撴灉', '鍒嗙被'],
      },
      'utility-link-group': {
        canonical: '鍔熻兘椤?',
        aliases: ['棣栭〉', '鍔熻兘椤?', '杩斿洖棣栭〉', '闃呰璁板綍'],
      },
    },
    statusExamples: {
      ...ZH_STATUS_QUERY_EXAMPLES,
      'content-link-group': ['鐜板湪鎵撳紑鐨勬槸鍝儴浣滃搧', '褰撳墠鍦ㄧ湅鍝儴浣滃搧', '褰撳墠椤垫槸鍝儴浣滃搧璇︽儏'],
      'author-link-group': ['鐜板湪鎵撳紑鐨勬槸鍝釜濂充紭椤?', '褰撳墠鍦ㄧ湅鍝釜濂充紭', '褰撳墠椤垫槸鍝綅濂充紭璇︽儏'],
      'search-form-group': ['褰撳墠鎼滅储鐨勬槸鍝儴浣滃搧', '鐜板湪鐨勬悳绱㈣瘝鏄粈涔?', '鐜板湪妫€绱㈢殑鏄摢閮ㄤ綔鍝?'],
    },
    searchQueryNouns: ['浣滃搧', '濂充紭', '婕斿憳', '鐣彿'],
    searchVerbTerms: [...ZH_SEARCH_VERBS, '鎼滅储浣滃搧', '鎼滅储濂充紭', '鏌ユ壘浣滃搧', '鏌ユ壘濂充紭', '鎼滀綔鍝?', '鎼滃コ浼?'],
    openVerbTerms: [...ZH_OPEN_VERBS, '鎵撳紑浣滃搧', '鏌ョ湅浣滃搧', '鎵撳紑濂充紭椤?', '鏌ョ湅濂充紭', '杩涘叆浣滃搧', '杩涘叆濂充紭椤?'],
    clarificationRules: [
      {
        clarificationRuleId: `clar_${createSha256('moodyz-search-target-ambiguous').slice(0, 12)}`,
        case: 'search-target-ambiguous',
        when: { match: 'moodyz-search-target-could-be-work-or-actress' },
        response: {
          mode: 'ask',
          questionTemplate: '杩欎釜鍚嶅瓧鏃㈠彲鑳芥槸浣滃搧锛屼篃鍙兘鏄コ浼樸€備綘瑕佺户缁寜鈥滀綔鍝佲€濊繕鏄€滃コ浼樷€濆鐞嗭紵',
          candidateLimit: 5,
          candidateSource: 'observed-values',
        },
        recovery: {
          expectedSlot: 'queryText|targetMemberId',
          resumeMode: 're-run-entry-rules',
        },
      },
      {
        clarificationRuleId: `clar_${createSha256('moodyz-search-results-disambiguation').slice(0, 12)}`,
        case: 'search-result-disambiguation',
        when: { match: 'moodyz-search-result-needs-disambiguation' },
        response: {
          mode: 'ask',
          questionTemplate: '鎼滅储缁撴灉閲屽悓鏃舵湁浣滃搧鍜屽コ浼樺€欓€夈€備綘鎯充紭鍏堢瓫浣滃搧杩樻槸濂充紭锛?',
          candidateLimit: 5,
          candidateSource: 'observed-values',
        },
        recovery: {
          expectedSlot: 'queryText',
          resumeMode: 're-run-entry-rules',
        },
      },
      {
        clarificationRuleId: `clar_${createSha256('moodyz-work-actress-ambiguous').slice(0, 12)}`,
        case: 'work-actress-ambiguous',
        when: { match: 'moodyz-target-matches-work-and-actress' },
        response: {
          mode: 'ask',
          questionTemplate: '杩欎釜璇嶅悓鏃跺彲鑳芥寚鍚戜綔鍝佸拰濂充紭锛岃鏄庣‘浣犺鎵撳紑鍝竴绫汇€?',
          candidateLimit: 5,
          candidateSource: 'observed-values',
        },
        recovery: {
          expectedSlot: 'targetMemberId|queryText',
          resumeMode: 're-run-entry-rules',
        },
      },
    ],
    buildGeneratedPatternExamples(context, patternType, fallbackValues) {
      if (context.slotName === 'queryText') {
        return fallbackValues.map((valueRecord) => {
          const label = valueRecord.label ?? String(valueRecord.value);
          if (context.intent.intentType === 'search-work') {
            return patternType === 'explicit-intent' ? `鎼滅储浣滃搧${label}` : label;
          }
          return patternType === 'explicit-intent' ? `鎼滅储${label}` : label;
        });
      }
      return fallbackValues.map((valueRecord) => {
        const label = valueRecord.label ?? String(valueRecord.value);
        if (context.intent.intentType === 'open-actress') {
          return patternType === 'explicit-intent' ? `鎵撳紑濂充紭椤?${label}` : label;
        }
        if (context.intent.intentType === 'open-work') {
          return patternType === 'explicit-intent' ? `鎵撳紑浣滃搧${label}` : label;
        }
        if (context.intent.intentType === 'search-work') {
          return patternType === 'explicit-intent' ? `鎼滅储浣滃搧${label}` : label;
        }
        return null;
      }).filter(Boolean);
    },
    rewriteClarificationRule(cloned) {
      if (cloned.case === 'missing-slot') {
        cloned.response.questionTemplate = '浣犺鎵惧摢閮ㄤ綔鍝佹垨鍝釜濂充紭锛熸垜鍙互鍒楀嚭褰撳墠鏈夊姩浣滆瘉鎹殑鍊欓€夐」銆?';
      } else if (cloned.case === 'ambiguous-target') {
        cloned.response.questionTemplate = '杩欎釜璇存硶鍙兘瀵瑰簲澶氶儴浣滃搧鎴栧涓コ浼橈紝璇风粰鎴戞洿鍏蜂綋鐨勪綔鍝佸悕鎴栧コ浼樺悕銆?';
      } else if (cloned.case === 'unsupported-target') {
        cloned.response.questionTemplate = '杩欎釜浣滃搧鎴栧コ浼樺彲浠ヨ瘑鍒紝浣嗗綋鍓嶆病鏈夊彲鎵ц鐨勫姩浣滆瘉鎹€傝涓嶈鎹竴涓凡瑙傚療鍒板彲鎵撳紑鐨勭洰鏍囷紵';
      } else if (cloned.case === 'book-ambiguous') {
        cloned.response.questionTemplate = '杩欎釜鍚嶅瓧鏃㈠彲鑳芥槸浣滃搧锛屼篃鍙兘鏄コ浼橈紝璇锋槑纭綘瑕佹墦寮€鍝竴绫汇€?';
      } else if (cloned.case === 'search-no-results') {
        cloned.response.questionTemplate = '绔欏唴娌℃湁鍛戒腑璇ヤ綔鍝佺粨鏋滐紝鍙互鎹竴涓洿鍏蜂綋鐨勪綔鍝佸悕锛屾垨鑰呮敼涓哄コ浼樺悕缁х画鎼滅储銆?';
      } else if (cloned.case === 'chapter-not-found') {
        cloned.response.questionTemplate = '娌℃湁鍖归厤鍒扮洰鏍囩珷鑺傦紝璇锋彁渚涙洿瀹屾暣鐨勭珷鑺傛爣棰樻垨绔犺妭搴忓彿銆?';
      }
      return cloned;
    },
  };
}
