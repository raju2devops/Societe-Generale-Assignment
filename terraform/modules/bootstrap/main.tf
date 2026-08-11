

resource "helm_release" "external_secrets" {
  name             = var.eso_service_account # also becomes the ServiceAccount name
  repository       = "https://charts.external-secrets.io"
  chart            = "external-secrets"
  version          = var.external_secrets_chart_version
  namespace        = var.eso_namespace
  create_namespace = true


  values = [yamlencode({

    serviceAccount = {
      annotations = {
        "azure.workload.identity/client-id" = var.workload_identity_client_id
        "azure.workload.identity/tenant-id" = var.tenant_id
      }
    }
    podLabels = {
      "azure.workload.identity/use" = "true"
    }
    replicaCount   = 1
    webhook        = { replicaCount = 1 }
    certController = { replicaCount = 1 }
  })]

  # CRDs have to be established before the ClusterSecretStore below is applied.
  wait    = true
  timeout = 600
}


resource "helm_release" "cluster_secret_store" {
  name      = "cluster-secret-store"
  chart     = "${path.module}/charts/secret-store"
  namespace = var.eso_namespace

  values = [yamlencode({
    name     = var.cluster_secret_store_name
    vaultUrl = var.key_vault_uri
    serviceAccount = {
      name      = var.eso_service_account
      namespace = var.eso_namespace
    }
  })]

  depends_on = [helm_release.external_secrets]
}


resource "helm_release" "mongodb" {
  count = var.mongodb_enabled ? 1 : 0

  name             = var.mongodb_release_name
  repository       = "https://charts.bitnami.com/bitnami"
  chart            = "mongodb"
  version          = var.mongodb_chart_version
  namespace        = var.app_namespace
  create_namespace = true

  values = [yamlencode({
    architecture = "replicaset"
    replicaCount = var.mongodb_replica_count
    arbiter = { enabled = false }

    auth = {
      enabled       = true
      rootUser      = "root"
      rootPassword  = var.mongodb_root_password
      usernames     = [var.mongodb_username]
      passwords     = [var.mongodb_password]
      databases     = [var.mongodb_database]
      replicaSetKey = var.mongodb_replica_set_key
    }

    replicaSetName = var.mongodb_replica_set_name


    resourcesPreset = var.mongodb_resources_preset

    persistence = {
      enabled = true
      size    = var.mongodb_storage_size
    }
  })]

  # StatefulSet rollout plus replica set election takes a while on small nodes.
  wait    = true
  timeout = 900
}

# Monitoring.

resource "helm_release" "kube_prometheus_stack" {
  count = var.monitoring_enabled ? 1 : 0

  name             = "kube-prometheus-stack"
  repository       = "https://prometheus-community.github.io/helm-charts"
  chart            = "kube-prometheus-stack"
  version          = var.monitoring_chart_version
  namespace        = var.monitoring_namespace
  create_namespace = true

  values = [yamlencode({
    prometheus = {
      prometheusSpec = {
  
        serviceMonitorSelectorNilUsesHelmValues = false
        podMonitorSelectorNilUsesHelmValues     = false
        ruleSelectorNilUsesHelmValues           = false

        retention = var.monitoring_retention

        resources = {
          requests = { cpu = "100m", memory = "512Mi" }
          limits   = { memory = "1Gi" }
        }
      }
    }

    grafana = {
      adminPassword = var.grafana_admin_password
      service   = { type = "ClusterIP" }
      resources = { requests = { cpu = "50m", memory = "128Mi" } }
    }

    alertmanager = {
      alertmanagerSpec = {
        resources = { requests = { cpu = "25m", memory = "64Mi" } }
      }
    }


    prometheusOperator = {
      resources = { requests = { cpu = "50m", memory = "128Mi" } }
    }

    "kube-state-metrics" = {
      resources = { requests = { cpu = "25m", memory = "64Mi" } }
    }
  })]

  wait    = true
  timeout = 900
}

resource "helm_release" "ingress_nginx" {
  name             = "ingress-nginx"
  repository       = "https://kubernetes.github.io/ingress-nginx"
  chart            = "ingress-nginx"
  version          = var.ingress_nginx_chart_version
  namespace        = "ingress-nginx"
  create_namespace = true

  values = [yamlencode({
    controller = {
      replicaCount = 1
      ingressClassResource = {
        name    = "nginx"
        enabled = true
        default = true
      }
      service = {
        annotations = {

          "service.beta.kubernetes.io/azure-load-balancer-health-probe-request-path" = "/healthz"
        }
      }

      metrics = {
        enabled = var.monitoring_enabled
        serviceMonitor = {
          enabled = var.monitoring_enabled
        }
      }
    }
  })]

  # The ServiceMonitor above needs the Prometheus Operator CRDs to exist first.
  depends_on = [helm_release.kube_prometheus_stack]

  wait    = true
  timeout = 600
}
