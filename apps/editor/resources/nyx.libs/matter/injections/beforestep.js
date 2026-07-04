
if ([/*%matterUseStaticDeltaTime%*/] == 'runner')  {
    if (this.matterEnable && !this.matterStatic) {

    }
}
if (this.matterEnable && this.matterBody) {
    if (this.matterLockAxisX || this.matterLockAxisY) {
        Matter.Body.setVelocity(this.matterBody, {
            x: this.matterLockAxisX ? 0 : this.matterBody.velocity.x,
            y: this.matterLockAxisY ? 0 : this.matterBody.velocity.y,
        });
    }
}
