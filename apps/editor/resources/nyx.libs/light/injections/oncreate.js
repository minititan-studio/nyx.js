if (templates.isCopy(this) && this.light) {
    this.updateTransform();
    light.updateOne(this.light);
}
