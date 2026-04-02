#!/usr/bin/env python3
import sys

if len(sys.argv) != 3:
    print("uso: env_to_yaml.py <in.env> <out.yaml>", file=sys.stderr)
    sys.exit(1)

env_file, out_file = sys.argv[1], sys.argv[2]
out_lines = []

with open(env_file, 'r', encoding='utf-8') as f:
    for raw in f:
        if not raw.strip() or raw.lstrip().startswith('#'):
            continue
        if '=' not in raw:
            continue
        k, v = raw.split('=', 1)
        k = k.strip()
        v = v.strip()
        # por si acaso; Cloud Run lo inyecta
        if k == "PORT":
            continue
        # escapar comillas/backslashes para YAML seguro
        v = v.replace('\\', '\\\\').replace('"', '\\"')
        out_lines.append(f'{k}: "{v}"')

with open(out_file, 'w', encoding='utf-8') as out:
    out.write("\n".join(out_lines) + "\n")

print(f"✳️  Env YAML generado en {out_file}")
