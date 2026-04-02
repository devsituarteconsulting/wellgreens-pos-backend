# =========================
# Configuración
# =========================
PROJECT_ID = ituarte-consulting-pos
REGION     = us-central1
SERVICE    = ituarte-consulting-api-dev

REPO       = containers
IMAGE_TAG  = v1
IMAGE_URI  := $(REGION)-docker.pkg.dev/$(PROJECT_ID)/$(REPO)/$(SERVICE):$(IMAGE_TAG)

CPU         ?= 2
MEMORY      ?= 1Gi
TIMEOUT     ?= 900s
MIN_INST    ?= 1
MAX_INST    ?= 50
CONCURRENCY ?= 80

# Tu archivo .env (siempre dev.env como pediste)
ENV_FILE  = config/env/dev.env

# No incluyas PORT aquí (Cloud Run lo reserva e inyecta)
ENV_VARS ?=
SECRETS  ?=

# =========================
# Ayuda
# =========================
help:
	@echo "make gcloud-init                     # login + habilitar APIs"
	@echo "make ar-init                         # crear repo Artifact Registry"
	@echo "make docker-build IMAGE_TAG=v1       # construir imagen"
	@echo "make docker-push  IMAGE_TAG=v1       # subir imagen"
	@echo "make deploy-image IMAGE_TAG=v1       # desplegar imagen con envs de $(ENV_FILE)"
	@echo "make logs                            # ver ultimos logs del servicio"
	@echo "make docker-run                      # correr contenedor local con $(ENV_FILE)"
	@echo "make push-env-from-file              # (opcional) actualizar envs planas"
	@echo "make push-env-from-file-yaml         # (opcional) actualizar envs via YAML"
	@echo "make create-secrets-from-file        # (opcional) crear/actualizar secretos"
	@echo "make link-secrets-to-service         # (opcional) vincular secretos"

# =========================
# gcloud / proyecto
# =========================
gcloud-init:
	gcloud auth login
	gcloud config set project $(PROJECT_ID)
	gcloud config set run/region $(REGION)
	gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

# =========================
# Artifact Registry
# =========================
ar-init:
	gcloud artifacts repositories create $(REPO) \
	  --repository-format=docker \
	  --location=$(REGION) || true
	gcloud auth configure-docker $(REGION)-docker.pkg.dev

# =========================
# Docker
# =========================
docker-build:
	docker build -t $(IMAGE_URI) .

docker-push:
	docker push $(IMAGE_URI)

# Correr local con tus envs (mapea 8080 -> 8080)
docker-run:
	docker run --rm -p 8080:8080 --env-file $(ENV_FILE) $(IMAGE_URI)

# =========================
# Cloud Run (deploy con Docker + envs del archivo)
# =========================
# Genera YAML temporal desde $(ENV_FILE)
.env-yaml:
	@test -f $(ENV_FILE) || (echo "$(ENV_FILE) no encontrado"; exit 1)
	@python3 scripts/env_to_yaml.py $(ENV_FILE) /tmp/env.yaml

# Despliegue pasando el YAML (sin --set-env-vars)
deploy-image: .env-yaml
	gcloud run deploy $(SERVICE) \
	  --image $(IMAGE_URI) \
	  --region $(REGION) \
	  --allow-unauthenticated \
	  --cpu=$(CPU) \
	  --memory=$(MEMORY) \
	  --timeout=$(TIMEOUT) \
	  --min-instances=$(MIN_INST) \
	  --max-instances=$(MAX_INST) \
	  --concurrency=$(CONCURRENCY) \
	  --env-vars-file /tmp/env.yaml \
	  $(if $(SECRETS),--update-secrets $(SECRETS),)

# Logs correctos del servicio
logs:
	gcloud run services logs read $(SERVICE) --region $(REGION) --limit 200

# =========================
# Cargar envs desde archivo (opcional post-deploy)
# =========================
# 1) En texto plano (ojo: falla con comas/URLs)
push-env-from-file:
	@test -f $(ENV_FILE) || (echo "$(ENV_FILE) no encontrado"; exit 1)
	@ENVVARS=$$(grep -v '^\s*#' $(ENV_FILE) | grep -v '^\s*$$' | paste -sd, -); \
	if [ -z "$$ENVVARS" ]; then echo "No hay variables en $(ENV_FILE)"; exit 1; fi; \
	echo "Subiendo env vars desde $(ENV_FILE)"; \
	gcloud run services update $(SERVICE) --region $(REGION) --set-env-vars $$ENVVARS

# 2) En YAML (recomendado)
push-env-from-file-yaml: .env-yaml
	gcloud run services update $(SERVICE) --region $(REGION) --env-vars-file /tmp/env.yaml

# =========================
# Secret Manager (opcional)
# =========================
create-secrets-from-file:
	@test -f $(ENV_FILE) || (echo "$(ENV_FILE) no encontrado"; exit 1)
	@while IFS='=' read -r k v; do \
	  [ -z "$$k" ] && continue; \
	  case "$$k" in \#*) continue ;; esac; \
	  echo "Creando/actualizando secreto $$k"; \
	  printf "%s" "$$v" | gcloud secrets versions add $$k --data-file=- 2>/dev/null \
	  || gcloud secrets create $$k --data-file=- ; \
	done < <(grep -v '^\s*#' $(ENV_FILE) | grep -v '^\s*$$')

link-secrets-to-service:
	@test -f $(ENV_FILE) || (echo "$(ENV_FILE) no encontrado"; exit 1)
	@SECS=$$(grep -v '^\s*#' $(ENV_FILE) | grep -v '^\s*$$' | cut -d= -f1 | sed 's/$$/:latest/' | paste -sd, -); \
	echo "Vinculando secretos: $$SECS"; \
	gcloud run services update $(SERVICE) --region $(REGION) --update-secrets $$SECS


# Primer deploy (incluye login, habilitar APIs y crear repo)
first-deploy: gcloud-init ar-init deploy

# Deploy normal (asume que gcloud-init y ar-init ya se ejecutaron antes)
deploy: docker-build docker-push deploy-image
	@echo "Deploy completo de $(SERVICE) con imagen $(IMAGE_URI)"
