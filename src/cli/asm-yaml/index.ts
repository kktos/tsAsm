import { binaryTag, CORE_SCHEMA, type DumpOptions, dump, loadAll, mergeTag, omapTag, pairsTag, setTag, timestampTag, YAMLException } from "js-yaml";
import { intTag } from "./int.tag";

// the js-yaml v4 default schema (core + timestamp, merge, binary, omap, pairs, set),
// with ints also accepting the $hex notation and dumped as hex
const schema = CORE_SCHEMA.withTags(intTag, timestampTag, mergeTag, binaryTag, omapTag, pairsTag, setTag);

export const yamlparse = (src: string) => {
	// like js-yaml v4: an empty source gives undefined, where v5 `load` throws
	const docs = loadAll(src, { schema });
	if (docs.length > 1) throw new YAMLException("expected a single document in the stream, but found more");
	return docs[0];
};

export const yamlstringify = (obj: object, opts?: DumpOptions) => {
	return dump(obj, { schema, sortKeys: true, ...opts });
};
