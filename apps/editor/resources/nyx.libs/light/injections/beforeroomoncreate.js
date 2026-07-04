if (this === rooms.current) {
    light.clear();
    light.ambientColor = u.hexToPixi(rooms.current.lightAmbientColor || '#FFFFFF');
    if (typeof rooms.current.lightAmbientOpacity === 'number') {
        light.opacity = rooms.current.lightAmbientOpacity;
    }
}
