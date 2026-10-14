/**
 * Parser OpenAPI 3.x dan Swagger 2.0 (JSON/YAML) → daftar ApiDefinition siap impor.
 */
import yaml from 'js-yaml';
import type { BodyField, FieldType, HttpMethod, ImportPreview, ImportedApi } from '@flowqa/shared';
import { HttpError } from '../lib/http';

type Json = Record<string, any>;
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const MAX_DEPTH = 6;

export function parseOpenApi(content: string): ImportPreview {
  let doc: Json;
  try {
    doc = JSON.parse(content);
  } catch {
    try {
      doc = yaml.load(content) as Json;
    } catch (error) {
      throw new HttpError(400, `The file is neither valid JSON nor YAML: ${(error as Error).message}`);
    }
  }
  if (!doc || typeof doc !== 'object' || !doc.paths) {
    throw new HttpError(
      400,
      'This file has no "paths" section, so it doesn’t look like an OpenAPI or Swagger file.',
    );
  }

  const resolveRef = (ref: string): Json | undefined =>
    ref
      .replace(/^#\//, '')
      .split('/')
      .reduce<any>((node, key) => node?.[key], doc);
  const deref = (node: any, depth = 0): any =>
    node?.$ref && depth < 10 ? deref(resolveRef(node.$ref), depth + 1) : node;

  const example = (schema: any, depth = 0): unknown => {
    schema = deref(schema);
    if (!schema || depth > MAX_DEPTH) return null;
    if (schema.example !== undefined) return schema.example;
    if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s: any) => example(s, depth + 1)));
    if (schema.type === 'object' || schema.properties) {
      return Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([k, v]) => [k, example(v, depth + 1)]),
      );
    }
    if (schema.type === 'array') return [example(schema.items, depth + 1)];
    if (schema.enum) return schema.enum[0];
    return (
      ({ integer: 1, number: 1.5, boolean: true, string: 'text' } as Record<string, unknown>)[schema.type] ??
      null
    );
  };

  const toFieldType = (schema: any): FieldType =>
    schema?.type === 'integer' || schema?.type === 'number'
      ? 'number'
      : schema?.type === 'boolean'
        ? 'boolean'
        : 'text';

  const basePath = doc.basePath && doc.basePath !== '/' ? String(doc.basePath).replace(/\/$/, '') : '';
  const apis: ImportedApi[] = [];

  for (const [path, operations] of Object.entries<Json>(doc.paths)) {
    for (const method of METHODS) {
      const op = operations[method];
      if (!op) continue;
      const params: Json[] = [...(operations.parameters ?? []), ...(op.parameters ?? [])].map((p) =>
        deref(p),
      );

      const bodySchema = op.requestBody
        ? deref((Object.values(deref(op.requestBody).content ?? {})[0] as Json | undefined)?.schema)
        : deref(params.find((p) => p.in === 'body')?.schema);
      const body: BodyField[] = Object.entries<any>(bodySchema?.properties ?? {}).map(([field, prop]) => {
        const schema = deref(prop) ?? {};
        const value = schema.example ?? example(schema);
        return {
          field,
          type: toFieldType(schema),
          value: value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value),
        };
      });

      const success = Object.entries<any>(op.responses ?? {}).find(([code]) => /^2/.test(code));
      let exampleResponse: unknown = {};
      if (success) {
        const response = deref(success[1]);
        const schema = response?.content
          ? (Object.values(response.content)[0] as Json | undefined)?.schema
          : response?.schema;
        exampleResponse = schema ? example(schema) : {};
      }

      const contentType = op.requestBody
        ? Object.keys(deref(op.requestBody).content ?? {})[0]
        : op.consumes?.[0];
      apis.push({
        name: op.summary || op.operationId || `${method.toUpperCase()} ${path}`,
        description: op.description ?? '',
        tag: op.tags?.[0] ?? 'General',
        method: method.toUpperCase() as HttpMethod,
        path: basePath + path,
        auth: (op.security ?? doc.security ?? []).length ? 'bearer' : 'none',
        contentType: contentType || 'application/json',
        headers: [],
        query: params
          .filter((p) => p.in === 'query')
          .map((p) => ({ key: p.name, value: String(p.example ?? p.schema?.example ?? '') })),
        body,
        exampleResponse,
      });
    }
  }

  if (!apis.length) throw new HttpError(400, 'The file has no GET, POST, PUT, PATCH or DELETE operations.');
  return { title: doc.info?.title ?? 'API', version: doc.info?.version ?? '', apis };
}
