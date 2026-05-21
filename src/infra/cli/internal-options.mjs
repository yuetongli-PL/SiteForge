// @ts-check

export function readCliValue(argv, index, flag = argv[index]) {
  if (index + 1 >= argv.length) {
    throw new Error(`Missing value for ${flag}`);
  }
  return { value: argv[index + 1], nextIndex: index + 1 };
}
