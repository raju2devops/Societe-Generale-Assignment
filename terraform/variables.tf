variable "subscription_id" {
  description = "Azure subscription to deploy into. Required by azurerm 4.x."
  type        = string
}

variable "name_prefix" {
  description = "Short prefix for every resource name. Lowercase alphanumerics only - it is also used to build the globally unique Key Vault name."
  type        = string
  default     = "sgbank"

  validation {
    condition     = can(regex("^[a-z0-9]{3,12}$", var.name_prefix))
    error_message = "name_prefix must be 3-12 lowercase letters or digits."
  }
}

variable "environment" {
  description = "Environment suffix used in resource names."
  type        = string
  default     = "test"
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "westeurope"
}

# ---- Cluster sizing ---------------------------------------------------------
# One node is the minimum that runs the app. The bitnami MongoDB replica set
# you are adding later wants three more pods, so expect to raise node_count to
# 2 or move to a larger size at that point.

variable "node_count" {
  description = <<-EOT
    Nodes in the single system pool.

    Two, because the MongoDB replica set requests 1500m on its own and a
    Standard_D2s_v6 only has 2000m before kube-system, ingress-nginx, External
    Secrets and the application take their share. Drop to 1 only with
    enable_mongodb = false, or a smaller mongodb_resources_preset.
  EOT
  type        = number
  default     = 2
}

variable "node_vm_size" {
  description = "VM size for the node pool. 2 vCPU / 8 GiB leaves headroom for ingress-nginx, External Secrets and both application tiers."
  type        = string

  # A size has to clear two independent gates, and checking only one is how you
  # get a 400 half way through an apply:
  #
  #   1. Not SKU-restricted for the subscription
  #        az vm list-skus -l <region> --resource-type virtualMachines --all false
  #   2. Its VM family has non-zero quota in the region
  #        az vm list-usage -l <region>
  #
  # On this subscription in westeurope, the burstable options fail one each:
  # Standard_B2ms is not offered at all, and Standard_B2s_v2 is unrestricted
  # but its "Standard Bsv2 Family vCPUs" quota is 0. Standard_D2s_v3 is
  # NotAvailableForSubscription. D2s_v6 clears both.
  default = "Standard_D2s_v6"
}

variable "kubernetes_version" {
  description = "AKS version. null tracks the region default."
  type        = string
  default     = null
}

# ---- Application secrets ----------------------------------------------------

variable "app_namespace" {
  description = "Namespace for the application and its database. Created by the bootstrap module, so `kubectl create namespace` is not needed."
  type        = string
  default     = "sg-bank"
}

variable "mongodb_uri" {
  description = <<-EOT
    Override for the connection string written to Key Vault.

    Leave empty to use the in-cluster MongoDB this configuration installs - the
    URI is composed from the generated credentials automatically. Set it (and
    enable_mongodb = false) to point the application at a managed database such
    as Atlas instead.
  EOT
  type        = string
  default     = ""
  sensitive   = true
}

# ---- In-cluster MongoDB -----------------------------------------------------

variable "enable_mongodb" {
  description = "Install the bitnami MongoDB replica set into app_namespace. Set false when using an external database via mongodb_uri."
  type        = bool
  default     = true
}

variable "mongodb_chart_version" {
  description = "bitnami/mongodb chart version."
  type        = string
  default     = "19.1.25"
}

variable "mongodb_replica_count" {
  description = "Members in the replica set."
  type        = number
  default     = 3
}

variable "mongodb_resources_preset" {
  description = <<-EOT
    bitnami resources preset for each member. This is what drives node_count:

      small (default)  500m / 512Mi requested  -> 1500m across three members
      micro            250m / 256Mi            -> 750m, but MongoDB's WiredTiger
                                                  cache floor is 256MB, so the
                                                  384Mi limit risks an OOM kill

    At "small" the set alone requests 1500m of a 2000m node, which is why one
    node cannot hold it alongside kube-system, ingress-nginx and the app.
  EOT
  type        = string
  default     = "small"
}

variable "seed_admin_email" {
  description = <<-EOT
    E-mail of the first administrator, created by the chart's post-install seed
    Job. Its password is generated and written to Key Vault as
    <secret_prefix>-seed-admin-password; read it back with:

      az keyvault secret show --vault-name <vault> \
        --name sg-bank-seed-admin-password --query value -o tsv

    The account is created with mustChangePassword, so the generated value is
    one-time-use and the application forces a change at first login.
  EOT
  type        = string
  default     = "admin@sg-bank.local"
}

variable "secret_prefix" {
  description = "Prefix for the Key Vault secret names. Must match the remoteRef keys in k8s/backend-values.yaml."
  type        = string
  default     = "sg-bank"
}

variable "extra_secret_admin_object_ids" {
  description = <<-EOT
    Additional Entra ID object IDs to grant Key Vault Secrets Officer, keyed by
    a stable label.

    Terraform grants that role to whoever runs it. When Terraform authenticates
    as a service principal, "whoever runs it" is the SP - so your own account
    gets no data-plane access, and the portal's Secrets blade reports "The
    operation is not allowed by RBAC" even though you are subscription Owner.
    Owner is a control-plane role; with rbac_authorization_enabled it does not
    grant permission to read or write secret values.

    Put your own object ID here to be able to use the portal and
    `az keyvault secret show`:

      az ad signed-in-user show --query id -o tsv
  EOT
  type        = map(string)
  default     = {}
}

# ---- Monitoring -------------------------------------------------------------

variable "enable_monitoring" {
  description = <<-EOT
    Install kube-prometheus-stack (Prometheus, Grafana, Alertmanager,
    node-exporter, kube-state-metrics) and turn on ingress-nginx's metrics
    endpoint and ServiceMonitor.

    The application exposes no /metrics of its own, so ingress-nginx is what
    supplies the application-level view: request rate, latency and status codes
    per host. Failed logins show as 401s and the rate limiter as 429s.

    Set false to reclaim roughly half a vCPU and a gigabyte of memory if pods
    start going Pending on a two-node cluster.
  EOT
  type        = bool
  default     = true
}

variable "monitoring_chart_version" {
  description = "prometheus-community/kube-prometheus-stack chart version."
  type        = string
  default     = "88.2.0"
}

variable "monitoring_retention" {
  description = "Prometheus sample retention. Storage is emptyDir, so this only affects memory - the chart default of 120h is far more than a demo needs."
  type        = string
  default     = "6h"
}

# ---- Add-on chart versions --------------------------------------------------

variable "external_secrets_chart_version" {
  description = "external-secrets/external-secrets chart version. 2.x serves the external-secrets.io/v1 API only."
  type        = string
  default     = "2.9.0"
}

variable "ingress_nginx_chart_version" {
  description = "ingress-nginx/ingress-nginx chart version."
  type        = string
  default     = "4.15.1"
}
