output "resource_group_name" {
  description = "Resource group holding everything."
  value       = azurerm_resource_group.this.name
}

output "aks_cluster_name" {
  description = "Cluster name."
  value       = module.aks.name
}

output "key_vault_name" {
  description = "Key Vault name."
  value       = module.keyvault.name
}

output "key_vault_uri" {
  description = "Key Vault data-plane URI."
  value       = module.keyvault.vault_uri
}

output "key_vault_id" {
  description = "Vault resource ID - the scope to use when granting yourself Key Vault Secrets Officer."
  value       = module.keyvault.id
}

output "key_vault_secret_names" {
  description = "Secrets written to the vault. These must match the remoteRef keys in k8s/backend-values.yaml."
  value       = module.keyvault.secret_names
}

output "eso_identity_client_id" {
  description = "Client ID of the identity External Secrets federates to."
  value       = azurerm_user_assigned_identity.eso.client_id
}

output "kubeconfig_command" {
  description = "Fetch cluster credentials."
  value       = "az aks get-credentials --resource-group ${azurerm_resource_group.this.name} --name ${module.aks.name} --overwrite-existing"
}

output "next_steps" {
  description = "What to run once apply finishes."
  value       = <<-EOT
    1. Credentials:
         az aks get-credentials -g ${azurerm_resource_group.this.name} -n ${module.aks.name} --overwrite-existing

    2. Confirm the secret store reached Key Vault (Ready should be True):
         kubectl get clustersecretstore cluster-secret-store -o wide

    3. Ingress public IP (may take a minute to be assigned):
         kubectl -n ingress-nginx get svc ingress-nginx-controller \
           -o jsonpath='{.status.loadBalancer.ingress[0].ip}'

       Point k8s/frontend-values.yaml `ingress.host` at a name resolving to it,
       and set the same value in `CORS_ORIGINS` in k8s/backend-values.yaml.

    4. MongoDB is already installed and its connection string is already in
       Key Vault - no manual step. Confirm the replica set is up:
         kubectl -n ${var.app_namespace} get pods -l app.kubernetes.io/name=mongodb

    5. Registry pull secret - the images are public, but the chart always
       renders imagePullSecrets, so the named secret has to exist. The
       namespace already exists:
         kubectl create secret docker-registry ghcr-pull-secret -n ${var.app_namespace} \
           --docker-server=ghcr.io --docker-username=raju2devops --docker-password=<PAT>

    6. Deploy the API first - the web pod's nginx resolves sg-bank-api at
       startup and crashloops if that Service is missing:
         helm upgrade --install sg-bank-api ../helm-chart -f ../k8s/backend-values.yaml -n ${var.app_namespace}
         helm upgrade --install sg-bank-web ../helm-chart -f ../k8s/frontend-values.yaml -n ${var.app_namespace}

    7. Monitoring. Grafana is ClusterIP only - deliberately not on the public
       ingress - so reach it through a port-forward:
         kubectl -n ${module.bootstrap.monitoring_namespace} port-forward svc/kube-prometheus-stack-grafana 3000:80
         # then http://localhost:3000  (user: admin)
         az keyvault secret show --vault-name ${module.keyvault.name} \
           --name ${var.secret_prefix}-grafana-admin-password --query value -o tsv

       Confirm ingress-nginx is actually being scraped - this is the step that
       catches an empty dashboard with no error:
         kubectl -n ${module.bootstrap.monitoring_namespace} port-forward svc/kube-prometheus-stack-prometheus 9090
         # then http://localhost:9090/targets and look for an ingress-nginx target UP
  EOT
}
