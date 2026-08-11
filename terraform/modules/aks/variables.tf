variable "name" {
  description = "Cluster name."
  type        = string
}

variable "location" {
  description = "Azure region."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group to create the cluster in."
  type        = string
}

variable "dns_prefix" {
  description = "DNS prefix for the cluster's API server."
  type        = string
}

variable "kubernetes_version" {
  description = "AKS version. null tracks the region default."
  type        = string
  default     = null
}

variable "node_count" {
  description = "Nodes in the system pool."
  type        = number
  default     = 1
}

variable "node_vm_size" {
  description = "Node VM size. Must be unrestricted for the subscription AND have non-zero family quota in the region - see the root variables.tf."
  type        = string
  default     = "Standard_D2s_v6"
}

variable "os_disk_size_gb" {
  description = "OS disk per node. 32 is well above what the node image needs and well below the 128 default."
  type        = number
  default     = 32
}

variable "tags" {
  description = "Tags applied to the cluster."
  type        = map(string)
  default     = {}
}
