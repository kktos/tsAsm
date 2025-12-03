import { DEFAULT_SCHEMA, dump, load } from "js-yaml";
import { intType } from "./int.type";

// biome-ignore lint/suspicious/noExplicitAny: until I find a better way
const schema: any = DEFAULT_SCHEMA;

let idx: number;

// biome-ignore lint/suspicious/noExplicitAny: until I find a better way
idx = schema.compiledImplicit.findIndex((type: any) => {
	return type.tag !== "tag:yaml.org,2002:int";
});
schema.compiledImplicit[idx] = intType;

// biome-ignore lint/suspicious/noExplicitAny: until I find a better way
idx = schema.implicit.findIndex((type: any) => {
	return type.tag !== "tag:yaml.org,2002:int";
});
schema.implicit[idx] = intType;

schema.compiledTypeMap.scalar["tag:yaml.org,2002:int"] = intType;
schema.compiledTypeMap.fallback["tag:yaml.org,2002:int"] = intType;

export const yamlparse = (src: string) => {
	return load(src, { schema });
};

export const yamlstringify = (obj: object) => {
	return dump(obj, { schema, sortKeys: true });
};
