data "azurerm_client_config" "current" {}

locals {
  name = "${var.name_prefix}-${var.environment}"

  tags = {
    project     = "sc-assignment"
    environment = var.environment
    managed_by  = "terraform"
  }


  eso_namespace       = "external-secrets"
  eso_service_account = "external-secrets"

  mongodb_release          = "mongodb"
  mongodb_database         = "sgbank"
  mongodb_username         = "sgbank_app"
  mongodb_replica_set_name = "rs0"

  mongodb_generated_uri = format(
    "mongodb://%s:%s@%s-headless.%s.svc.cluster.local:27017/%s?replicaSet=%s&authSource=%s",
    local.mongodb_username,
    random_password.mongodb_app.result,
    local.mongodb_release,
    var.app_namespace,
    local.mongodb_database,
    local.mongodb_replica_set_name,
    local.mongodb_database,
  )

  mongodb_uri = (
    var.mongodb_uri != "" ? var.mongodb_uri :
    var.enable_mongodb ? local.mongodb_generated_uri : "mongodb://replace-me:27017/${local.mongodb_database}"
  )
}

resource "azurerm_resource_group" "this" {
  name     = "${local.name}-rg"
  location = var.location
  tags     = local.tags
}

# Cluster

module "aks" {
  source = "./modules/aks"

  name                = "${local.name}-aks"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  dns_prefix          = local.name
  kubernetes_version  = var.kubernetes_version
  node_count          = var.node_count
  node_vm_size        = var.node_vm_size
  tags                = local.tags
}

# -----------------------------------------------------------------------------
# Generated application secrets
#
# Formats are dictated by apps/backend/src/config/env.js, which refuses to start on
# anything else: JWT_SECRET >= 64 characters, and the two key material values
# exactly 64 hex characters (32 bytes) for AES-256-GCM and HMAC-SHA256.
# random_id renders byte_length * 2 hex characters.
# -----------------------------------------------------------------------------
resource "random_id" "jwt_secret" {
  byte_length = 48 # 96 hex chars
}

resource "random_id" "field_enc_key" {
  byte_length = 32 # 64 hex chars
}

resource "random_id" "blind_index_key" {
  byte_length = 32 # 64 hex chars
}

# -----------------------------------------------------------------------------
# MongoDB credentials
#
# special = false on purpose. These go straight into a mongodb:// URI, where
# @ : / ? # [ ] all have meaning and would need percent-encoding. Restricting
# the alphabet is simpler than encoding, and 24 alphanumerics is ~140 bits.
# -----------------------------------------------------------------------------
resource "random_password" "mongodb_root" {
  length  = 24
  special = false
}

resource "random_password" "mongodb_app" {
  length  = 24
  special = false
}

resource "random_password" "mongodb_replica_set_key" {
  length  = 32
  special = false
}


resource "random_password" "seed_admin" {
  length           = 24
  min_upper        = 2
  min_lower        = 2
  min_numeric      = 2
  min_special      = 2
  override_special = "-_.!*"
}


resource "random_password" "grafana_admin" {
  length           = 20
  min_upper        = 2
  min_lower        = 2
  min_numeric      = 2
  special          = true
  min_special      = 1
  override_special = "-_."
}

# Key Vault

module "keyvault" {
  source = "./modules/keyvault"

  name_prefix         = var.name_prefix
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  tags                = local.tags


  # Azure identifies a role assignment by (scope, role, principal); the map key
  # is only a label. Under plain `az login` auth extra_secret_admin_object_ids
  # normally repeats the object ID Terraform already grants to itself, and the
  # second assignment fails with 409 RoleAssignmentExists. Collapse by object ID
  # first - keyed by ID, then flipped back - letting the caller's label win.
  writer_principal_ids = {
    for id, label in merge(
      { (data.azurerm_client_config.current.object_id) = "terraform" },
      { for l, i in var.extra_secret_admin_object_ids : i => l },
    ) : label => id
  }
  reader_principal_ids = {
    external-secrets = azurerm_user_assigned_identity.eso.principal_id
  }

  secrets = {
    "${var.secret_prefix}-jwt-secret"      = random_id.jwt_secret.hex
    "${var.secret_prefix}-field-enc-key"   = random_id.field_enc_key.hex
    "${var.secret_prefix}-blind-index-key" = random_id.blind_index_key.hex

    "${var.secret_prefix}-mongodb-uri" = local.mongodb_uri

    # Consumed by the chart's post-install seed Job, not by the API itself.
    "${var.secret_prefix}-seed-admin-email"    = var.seed_admin_email
    "${var.secret_prefix}-seed-admin-password" = random_password.seed_admin.result

    "${var.secret_prefix}-grafana-admin-password" = random_password.grafana_admin.result
  }
}

# Workload identity - the bridge between the cluster and Key Vault

resource "azurerm_user_assigned_identity" "eso" {
  name                = "${local.name}-eso-identity"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
}

resource "azurerm_federated_identity_credential" "eso" {
  name                      = "external-secrets"
  user_assigned_identity_id = azurerm_user_assigned_identity.eso.id
  audience                  = ["api://AzureADTokenExchange"]
  issuer                    = module.aks.oidc_issuer_url
  subject = "system:serviceaccount:${local.eso_namespace}:${local.eso_service_account}"
}

# -----------------------------------------------------------------------------
# In-cluster add-ons the application's helm chart assumes are present
# -----------------------------------------------------------------------------
module "bootstrap" {
  source = "./modules/bootstrap"

  external_secrets_chart_version = var.external_secrets_chart_version
  ingress_nginx_chart_version    = var.ingress_nginx_chart_version

  eso_namespace       = local.eso_namespace
  eso_service_account = local.eso_service_account

  key_vault_uri               = module.keyvault.vault_uri
  workload_identity_client_id = azurerm_user_assigned_identity.eso.client_id
  tenant_id                   = data.azurerm_client_config.current.tenant_id

  app_namespace            = var.app_namespace
  mongodb_enabled          = var.enable_mongodb
  mongodb_chart_version    = var.mongodb_chart_version
  mongodb_release_name     = local.mongodb_release
  mongodb_replica_count    = var.mongodb_replica_count
  mongodb_replica_set_name = local.mongodb_replica_set_name
  mongodb_resources_preset = var.mongodb_resources_preset
  mongodb_database         = local.mongodb_database
  mongodb_username         = local.mongodb_username
  mongodb_password         = random_password.mongodb_app.result
  mongodb_root_password    = random_password.mongodb_root.result
  mongodb_replica_set_key  = random_password.mongodb_replica_set_key.result

  monitoring_enabled       = var.enable_monitoring
  monitoring_chart_version = var.monitoring_chart_version
  monitoring_retention     = var.monitoring_retention
  grafana_admin_password   = random_password.grafana_admin.result

  # Both the role assignment and the federated credential have to land before
  # the operator first tries to read, or the sync 403s and backs off.
  depends_on = [module.keyvault, azurerm_federated_identity_credential.eso]
}
